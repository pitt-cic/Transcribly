import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import AudioPlayer from '../components/AudioPlayer';
import StarIcon from '../components/StarIcon';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { getTranscriptJob, pollForTranscriptCompletion, fetchTranscriptFromS3, fetchAudioFromS3, deleteTranscript, updateTranscriptTitle, updateTranscriptSegments, updateTranscriptStarred } from '../services/transcriptService';
import { Loader2, AlertTriangle, Pencil, Search, ChevronLeft, ChevronRight } from 'lucide-react';

const FILLER_WORDS = new Set([
  'um', 'uh', 'uhh', 'umm', 'hmm', 'hm', 'mhm', 'you know', 'i mean', 'no',
]);

const normalize = (w: string) => w.toLowerCase().replace(/[.,!?]$/, '');

const MAX_PHRASE_LEN = 4;

const deduplicatePhrases = (words: Word[]): Word[] => {
  let current = words;
  let changed = true;
  while (changed) {
    changed = false;
    const next: Word[] = [];
    let i = 0;
    while (i < current.length) {
      let matched = false;
      for (let len = MAX_PHRASE_LEN; len >= 2; len--) {
        if (i + len * 2 > current.length) continue;
        const a = current.slice(i, i + len).map(w => normalize(w.word));
        const b = current.slice(i + len, i + len * 2).map(w => normalize(w.word));
        if (a.every((w, j) => w === b[j])) {
          for (let k = 0; k < len; k++) next.push(current[i + k]); // keep first copy
          i += len * 2; // skip second copy
          matched = true;
          changed = true;
          break;
        }
      }
      if (!matched) next.push(current[i++]);
    }
    current = next;
  }
  return current;
};

const SEGMENTS_PER_PAGE = 50;

const filterFillerWords = (segments: TranscriptSegment[]): TranscriptSegment[] => {
  const filtered = segments.map(seg => {
    if (!seg.words) return seg;
    let words = seg.words.filter(w => !FILLER_WORDS.has(normalize(w.word)));
    words = words.filter(w => normalize(w.word) !== ''); // remove standalone punctuation tokens
    words = words.filter((w, i) => i === 0 || normalize(w.word) !== normalize(words[i - 1].word));
    words = deduplicatePhrases(words);
    return { ...seg, words, text: words.map(w => w.word).join(' ') };
  });

  // Remove words at segment boundaries that duplicate the last word of the previous segment
  for (let i = 1; i < filtered.length; i++) {
    const prev = filtered[i - 1].words;
    const curr = filtered[i].words;
    if (!prev?.length || !curr?.length) continue;
    const lastWord = normalize(prev[prev.length - 1].word);
    let trimStart = 0;
    while (trimStart < curr.length && normalize(curr[trimStart].word) === lastWord) {
      trimStart++;
    }
    if (trimStart > 0) {
      const words = curr.slice(trimStart);
      filtered[i] = { ...filtered[i], words, text: words.map(w => w.word).join(' ') };
    }
  }

  return filtered;
};

interface Speaker {
  name: string;
  color: string;
  colorHex: string;
}

interface TranscriptSegment {
  time: string;
  speaker: Speaker;
  text: string;
  id: string;
  words?: Word[];
  segmentEnd?: string;
}

interface Word {
  word: string;
  start: string;
  end: string;
  confidence: number;
}

interface RawSegment {
  speaker: string;
  start: string;
  end: string;
  text: string;
  words: Word[];
}

interface RawTranscriptData {
  jobId: string;
  userId: string;
  completedAt: string;
  speakerCount: number;
  wordCount: number;
  durationSec: number;
  segments: RawSegment[];
}

const TranscriptPage = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { seekTo, play, currentTime, isPlaying } = useAudioPlayer();
  const [selectedSpeakers, setSelectedSpeakers] = useState<string[]>([]);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editedSegmentText, setEditedSegmentText] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeSpeakerOptions, setMergeSpeakerOptions] = useState<Speaker[]>([]);
  const [isMergeMode, setIsMergeMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(true);
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [editedSpeakerName, setEditedSpeakerName] = useState('');
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [pollingStatus, setPollingStatus] = useState<'polling' | 'completed' | 'failed' | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Starting transcription...');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speakerInputRef = useRef<HTMLInputElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Available colors for speakers
  const availableSpeakerColors = [
    { color: 'speaker-orange', colorHex: '#F27F37' },
    { color: 'speaker-blue', colorHex: '#5AB9FC' },
    { color: 'speaker-green', colorHex: '#61EBA5' },
    { color: 'speaker-pink', colorHex: '#F066B8' },
    { color: 'speaker-purple', colorHex: '#A78BFA' },
    { color: 'speaker-yellow', colorHex: '#FCD34D' },
  ];

  // Speaker color mapping - dynamically initialized based on actual speakers
  const [speakerColors, setSpeakerColors] = useState<Record<string, { name: string; color: string; colorHex: string }>>({});

  // Title and save state
  const [transcriptTitle, setTranscriptTitle] = useState<string>('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitleValue, setEditedTitleValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStarred, setIsStarred] = useState((location.state as { starred?: boolean })?.starred || false);
  const [isTogglingStarred, setIsTogglingStarred] = useState(false);
  const [redactionStatus, setRedactionStatus] = useState<string>('');

  // Job metadata
  const [_uploadedDate, setUploadedDate] = useState<string>('');
  const [completedDate, setCompletedDate] = useState<string>('');

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Pagination state
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState(1);

  // Initialize page from URL on mount
  useEffect(() => {
    const pageParam = searchParams.get('page');
    if (pageParam) {
      const page = parseInt(pageParam, 10);
      if (!isNaN(page) && page > 0) {
        setCurrentPage(page);
      }
    }
  }, []);

  // Update URL when page changes
  useEffect(() => {
    if (currentPage > 1) {
      setSearchParams({ page: currentPage.toString() });
    } else {
      setSearchParams({});
    }
  }, [currentPage, setSearchParams]);

  const speakers: Speaker[] = Object.values(speakerColors);

  // Confidence filter state
  const [showConfidenceFilter, setShowConfidenceFilter] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8);
  const [isConfidenceFilterActive, setIsConfidenceFilterActive] = useState(false);
  const [lowConfidenceWords, setLowConfidenceWords] = useState<Array<{
    segmentId: string;
    wordIndex: number;
    confidence: number;
  }>>([]);
  const [currentLowConfidenceIndex, setCurrentLowConfidenceIndex] = useState(0);

  // Format seconds to HH:MM:SS or MM:SS
  const formatTime = (seconds: string | number) => {
    const sec = typeof seconds === 'string' ? parseFloat(seconds) : seconds;
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format date for display with time
  const formatDisplayDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Initialize speaker colors dynamically based on transcript data
  const initializeSpeakerColors = (rawData: RawTranscriptData) => {
    // Safety check for segments
    if (!rawData || !rawData.segments || !Array.isArray(rawData.segments) || rawData.segments.length === 0) {
      return {};
    }

    // Get unique speaker IDs from the transcript
    const uniqueSpeakers = Array.from(new Set(rawData.segments.map(seg => seg?.speaker).filter(Boolean)));

    // Create speaker color mapping
    const newSpeakerColors: Record<string, { name: string; color: string; colorHex: string }> = {};
    uniqueSpeakers.forEach((speakerId, index) => {
      const colorIndex = index % availableSpeakerColors.length;
      const colorInfo = availableSpeakerColors[colorIndex];
      newSpeakerColors[speakerId] = {
        name: `Speaker ${index + 1}`,
        color: colorInfo.color,
        colorHex: colorInfo.colorHex,
      };
    });

    setSpeakerColors(newSpeakerColors);
    return newSpeakerColors;
  };

  // Convert raw transcript data to UI format
  const convertRawTranscript = (rawData: RawTranscriptData, speakerColorsMap: Record<string, { name: string; color: string; colorHex: string }>): TranscriptSegment[] => {
    // Safety check for segments
    if (!rawData || !rawData.segments || !Array.isArray(rawData.segments)) {
      return [];
    }

    return rawData.segments
      .filter(segment => segment && segment.text) // Filter out invalid segments
      .map((segment, index) => ({
        id: `segment-${index}`,
        time: formatTime(segment.start || 0),
        speaker: speakerColorsMap[segment.speaker] || speakerColorsMap[Object.keys(speakerColorsMap)[0]] || { name: 'Speaker', color: 'speaker-orange', colorHex: '#F27F37' },
        text: segment.text || '',
        words: segment.words || [],
        segmentEnd: segment.end || segment.start,
      }));
  };

  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const rawTranscript = useRef<TranscriptSegment[]>([]);
  const [rawTranscriptVersion, setRawTranscriptVersion] = useState(0);
  const [hideFillers, setHideFillers] = useState(true);

  // Redirect to upload if no jobId
  useEffect(() => {
    if (!jobId) {
      navigate('/upload');
    }
  }, [jobId, navigate]);

  // Load transcript with polling support
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;

    // Reset per-transcript state immediately to avoid stale values flashing
    setRedactionStatus('');
    setTranscriptTitle('');
    setPollingStatus(null);

    const loadTranscript = async () => {
      try {
        setIsLoadingTranscript(true);
        setTranscriptError(null);

        // First, check the job status
        const job = await getTranscriptJob(jobId);
        if (cancelled) return;

        if (job.transcription_status === 'COMPLETED') {
          // If redaction hasn't finished yet, wait for it before loading
          let finalJob = job;
          if (!job.redaction_status) {
            setPollingStatus('polling');
            setStatusMessage('Redacting PHI...');
            let attempts = 0;
            while (!finalJob.redaction_status && attempts < 60) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              if (cancelled) return;
              finalJob = await getTranscriptJob(jobId);
              if (cancelled) return;
              attempts++;
            }
          }

          setStatusMessage('Loading transcript...');

          // Set transcript title and dates
          const title = finalJob.title || finalJob.filename || `Transcript ${jobId.slice(0, 8)}`;
          setTranscriptTitle(title);
          setUploadedDate(finalJob.uploaded_at || '');
          setCompletedDate(finalJob.edited_at || finalJob.completed_at || finalJob.uploaded_at || '');
          setIsStarred(finalJob.starred || false);
          setRedactionStatus(finalJob.redaction_status || '');

          // Use edited version if available, otherwise use original
          const transcriptKey = finalJob.edited_key || finalJob.transcript_key;
          const rawData = await fetchTranscriptFromS3(jobId, transcriptKey);
          if (cancelled) return;

          // Both original and edited transcripts are now in the same format
          const speakerColorsMap = initializeSpeakerColors(rawData);
          const convertedTranscript = convertRawTranscript(rawData, speakerColorsMap);
          const mergedTranscript = mergeConsecutiveSpeakers(convertedTranscript);
          rawTranscript.current = mergedTranscript;
          setRawTranscriptVersion(v => v + 1);

          // Fetch audio from S3
          if (finalJob.audio_key) {
            try {
              setStatusMessage('Loading audio...');
              const audioUrl = await fetchAudioFromS3(finalJob.audio_key);
              if (!cancelled) {
                setAudioUrl(audioUrl);
              }
            } catch (error) {
              console.error('Failed to load audio:', error);
              // Continue anyway - transcript will work without audio
            }
          }

          setPollingStatus('completed');
        } else if (job.transcription_status === 'FAILED') {
          // Job failed
          setTranscriptError(job.error_msg || 'Transcription failed');
          setPollingStatus('failed');
        } else {
          // Job is still in progress, start polling
          setPollingStatus('polling');
          setStatusMessage('Transcribing audio...');

          const completedJob = await pollForTranscriptCompletion(
            jobId,
            (status) => {
              // Update status message based on progress
              if (!cancelled && status === 'IN_PROGRESS') {
                setStatusMessage('Processing speakers and generating transcript...');
              }
            }
          );
          if (cancelled) return;

          // Wait for redaction to finish before loading (backend sets transcription_status
          // COMPLETED before redaction runs, so we must wait for redaction_status to appear)
          let finalCompletedJob = completedJob;
          if (!completedJob.redaction_status) {
            setStatusMessage('Redacting PHI...');
            let attempts = 0;
            while (!finalCompletedJob.redaction_status && attempts < 60) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              if (cancelled) return;
              finalCompletedJob = await getTranscriptJob(jobId);
              if (cancelled) return;
              attempts++;
            }
          }

          // Fetch the completed transcript
          setStatusMessage('Loading transcript...');
          const rawData = await fetchTranscriptFromS3(jobId, finalCompletedJob.transcript_key);
          if (cancelled) return;

          setTranscriptTitle(finalCompletedJob.title || finalCompletedJob.filename || `Transcript ${jobId.slice(0, 8)}`);
          setUploadedDate(finalCompletedJob.uploaded_at || '');
          setCompletedDate(finalCompletedJob.edited_at || finalCompletedJob.completed_at || finalCompletedJob.uploaded_at || '');
          setIsStarred(finalCompletedJob.starred || false);
          setRedactionStatus(finalCompletedJob.redaction_status || '');

          const speakerColorsMap = initializeSpeakerColors(rawData);
          const convertedTranscript = convertRawTranscript(rawData, speakerColorsMap);
          const mergedTranscript = mergeConsecutiveSpeakers(convertedTranscript);
          rawTranscript.current = mergedTranscript;
          setRawTranscriptVersion(v => v + 1);

          // Fetch audio from S3
          if (finalCompletedJob.audio_key) {
            try {
              setStatusMessage('Loading audio...');
              const audioUrl = await fetchAudioFromS3(finalCompletedJob.audio_key);
              if (!cancelled) {
                setAudioUrl(audioUrl);
              }
            } catch (error) {
              console.error('Failed to load audio:', error);
              // Continue anyway - transcript will work without audio
            }
          }

          setPollingStatus('completed');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Error loading transcript:', error);
        setTranscriptError(error instanceof Error ? error.message : 'Failed to load transcript');
        setPollingStatus('failed');
      } finally {
        if (!cancelled) {
          setIsLoadingTranscript(false);
        }
      }
    };

    loadTranscript();

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (rawTranscript.current.length === 0) return;
    setTranscript(hideFillers ? filterFillerWords(rawTranscript.current) : rawTranscript.current);
  }, [hideFillers, rawTranscriptVersion]);

  // Helper function to derive display text from words array
  const deriveTextFromWords = (words?: Word[]): string => {
    if (!words || words.length === 0) return '';

    // Simply join with spaces - let rendering handle punctuation display
    return words.map(w => w.word).join(' ');
  };

  // Helper function to merge consecutive same-speaker segments
  const mergeConsecutiveSpeakers = (segments: TranscriptSegment[]): TranscriptSegment[] => {
    if (segments.length === 0) return segments;

    const merged: TranscriptSegment[] = [];
    for (let i = 0; i < segments.length; i++) {
      const currentSegment = segments[i];

      // If this is the first segment or speaker is different from previous, add it
      if (merged.length === 0 ||
          merged[merged.length - 1].speaker.name !== currentSegment.speaker.name) {
        merged.push({ ...currentSegment });
      } else {
        // Same speaker as previous segment - merge the words arrays
        const lastSegment = merged[merged.length - 1];

        // Merge words arrays if both exist
        if (lastSegment.words && currentSegment.words) {
          lastSegment.words = [...lastSegment.words, ...currentSegment.words];
          lastSegment.text = deriveTextFromWords(lastSegment.words);
        } else if (!lastSegment.words && !currentSegment.words) {
          // Both have no words - just concatenate text
          lastSegment.text = lastSegment.text + ' ' + currentSegment.text;
        } else {
          // One has words, one doesn't - keep them separate
          merged.push({ ...currentSegment });
        }
      }
    }

    return merged;
  };

  // Handle word click to jump to timestamp
  const handleWordClick = (startTime: string) => {
    const timeInSeconds = parseFloat(startTime);
    seekTo(timeInSeconds);
    play();
  };

  // Binary search to find segment containing currentTime
  const findSegmentByTime = (segments: TranscriptSegment[], time: number): number => {
    let left = 0;
    let right = segments.length - 1;

    while (left <= right) {
      const mid = (left + right) >> 1; // Faster than Math.floor((left + right) / 2)
      const segment = segments[mid];

      if (!segment.words || segment.words.length === 0) {
        return mid;
      }

      const segmentStart = parseFloat(segment.words[0].start);
      const segmentEnd = parseFloat(segment.words[segment.words.length - 1].end);

      if (time >= segmentStart && time <= segmentEnd) {
        return mid;
      } else if (time < segmentStart) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return Math.max(0, Math.min(right, segments.length - 1));
  };

  // Memoize active word calculation - only recalculate when time changes significantly
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [_lastCheckedSegmentIndex, setLastCheckedSegmentIndex] = useState(0);

  // Track only segment count to preserve cache when text changes
  const transcriptSegmentCount = transcript.length;

  useEffect(() => {
    if (!isPlaying) {
      setActiveWordId(null);
      return;
    }

    // Binary search to find likely segment - O(log n) instead of O(n)
    const segmentIndex = findSegmentByTime(transcript, currentTime);

    // Search within segment and next 2 segments (covers word boundaries)
    for (let offset = 0; offset < 3 && segmentIndex + offset < transcript.length; offset++) {
      const segment = transcript[segmentIndex + offset];
      if (!segment.words) continue;

      for (let i = 0; i < segment.words.length; i++) {
        const word = segment.words[i];
        const startTime = parseFloat(word.start);
        const endTime = parseFloat(word.end);

        if (currentTime >= startTime && currentTime <= endTime) {
          const wordId = `${segment.id}-word-${i}`;
          if (activeWordId !== wordId) {
            setActiveWordId(wordId);
            setLastCheckedSegmentIndex(segmentIndex + offset);
          }
          return;
        }
      }
    }

    setActiveWordId(null);
  }, [currentTime, isPlaying, transcriptSegmentCount]);

  // Check if a word is currently being spoken (optimized)
  const isWordActive = (segmentId: string, wordIndex: number) => {
    return activeWordId === `${segmentId}-word-${wordIndex}`;
  };

  // Auto-scroll to active word (optimized - only when activeWordId changes)
  useEffect(() => {
    if (!activeWordRef.current) return;

    // Use 'instant' scroll for better sync, 'smooth' can lag behind fast audio
    activeWordRef.current.scrollIntoView({
      behavior: 'instant',
      block: 'center',
    });
  }, [activeWordId]);

  // Auto-focus textarea when editing segment
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingSegmentId]);

  // Auto-focus input when editing speaker name
  useEffect(() => {
    if (speakerInputRef.current) {
      speakerInputRef.current.focus();
      speakerInputRef.current.select();
    }
  }, [editingSpeakerId]);

  // Auto-focus find input when opening dialog
  useEffect(() => {
    if (showFindReplace && findInputRef.current) {
      findInputRef.current.focus();
    }
  }, [showFindReplace]);

  // Keyboard shortcuts for confidence filter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + G: Open confidence filter (only if not already open)
      if ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey && !showConfidenceFilter) {
        e.preventDefault();
        setShowConfidenceFilter(true);
      }

      // F3 or Ctrl+G (with filter active): Next low-confidence word
      if (isConfidenceFilterActive && !showConfidenceFilter && (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && e.key === 'g' && !e.shiftKey))) {
        e.preventDefault();
        navigateToNextLowConfidence();
      }

      // Shift+F3 or Ctrl+Shift+G: Previous low-confidence word
      if (isConfidenceFilterActive && !showConfidenceFilter && ((e.key === 'F3' && e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'G'))) {
        e.preventDefault();
        navigateToPrevLowConfidence();
      }

      // Escape: Close filter modal if open
      if (e.key === 'Escape' && showConfidenceFilter) {
        setShowConfidenceFilter(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfidenceFilter, isConfidenceFilterActive, currentLowConfidenceIndex, lowConfidenceWords]);

  const startEditingSegment = (segmentId: string, currentText: string) => {
    setEditingSegmentId(segmentId);
    setEditedSegmentText(currentText);
  };

  const saveSegmentEdit = (segmentId: string) => {
    if (!editingSegmentId) return;

    // If text is empty, delete the segment
    if (!editedSegmentText.trim()) {
      setTranscript(prev => prev.filter(seg => seg.id !== segmentId));
      setEditingSegmentId(null);
      setEditedSegmentText('');
      return;
    }

    setTranscript(prev =>
      prev.map(seg => {
        if (seg.id === segmentId && seg.words && seg.words.length > 0) {
          const editedWords = editedSegmentText.trim().split(/\s+/);
          const originalWords = seg.words;

          // Helper function to normalize words for comparison
          const normalize = (word: string) => word.toLowerCase().replace(/[.,!?;:'"()-]/g, '');

          console.log('═══════════════════════════════════════════════');
          console.log('🔧 EDIT TEST STARTED');
          console.log('Original text:', originalWords.map(w => w.word).join(' '));
          console.log('Edited text:', editedWords.join(' '));
          console.log('Original words array:', originalWords);

          // Step 1: Match from START (forward)
          let matchFromStart = 0;
          while (matchFromStart < originalWords.length &&
                 matchFromStart < editedWords.length &&
                 normalize(originalWords[matchFromStart].word) === normalize(editedWords[matchFromStart])) {
            matchFromStart++;
          }

          // Step 2: Match from END (backward)
          let matchFromEnd = 0;
          while (matchFromEnd < originalWords.length - matchFromStart &&
                 matchFromEnd < editedWords.length - matchFromStart &&
                 normalize(originalWords[originalWords.length - 1 - matchFromEnd].word) ===
                 normalize(editedWords[editedWords.length - 1 - matchFromEnd])) {
            matchFromEnd++;
          }

          console.log('📊 Matching Results:');
          console.log('  - matchFromStart:', matchFromStart, '→', editedWords.slice(0, matchFromStart).join(' '));
          console.log('  - matchFromEnd:', matchFromEnd, '→', editedWords.slice(-matchFromEnd).join(' '));

          // Step 3: Determine edit type
          const editedMiddleWords = editedWords.slice(matchFromStart, editedWords.length - matchFromEnd);
          const originalMiddleWords = originalWords.slice(matchFromStart, originalWords.length - matchFromEnd);
          const originalRegionSize = originalMiddleWords.length;
          const editedRegionSize = editedMiddleWords.length;

          console.log('📝 Edit Region:');
          console.log('  - Original middle:', originalMiddleWords.map(w => w.word).join(' '), `(${originalRegionSize} words)`);
          console.log('  - Edited middle:', editedMiddleWords.join(' '), `(${editedRegionSize} words)`);

          // Step 4: Build result array
          const newWords: Word[] = [];
          let skipFirstEndWord = false;  // Track if we consumed first END word in merge

          // Add unchanged words from START
          for (let i = 0; i < matchFromStart; i++) {
            newWords.push({
              ...originalWords[i],
              word: editedWords[i]  // Use edited version (preserves punctuation changes)
            });
          }

          // Handle EDITED REGION
          if (editedMiddleWords.length > 0) {
            if (editedRegionSize > originalRegionSize) {
              console.log('🔀 Operation: ADDITION/REPLACE WITH MORE');
              // ADDITION or REPLACE WITH MORE
              // Strategy: Map first N to originals 1:1, merge extras with adjacent
              const numToMap = originalRegionSize;
              const numToMerge = editedRegionSize - originalRegionSize;
              console.log(`  - Mapping first ${numToMap} words 1:1`);
              console.log(`  - Merging ${numToMerge} extra words with adjacent`);

              if (numToMap === 0) {
                // Pure ADDITION (no original words to replace)
                if (matchFromStart === 0 && matchFromEnd > 0) {
                  // Add at BEGINNING - merge with first matched word
                  const firstMatchedOriginal = originalWords[originalWords.length - matchFromEnd];
                  const firstEditedMatched = editedWords[editedWords.length - matchFromEnd];
                  const bundledText = editedMiddleWords.join(' ') + ' ' + firstEditedMatched;

                  newWords.push({
                    word: bundledText,
                    start: firstMatchedOriginal.start,
                    end: firstMatchedOriginal.end,
                    confidence: firstMatchedOriginal.confidence
                  });

                  skipFirstEndWord = true;

                } else if (matchFromEnd === 0 && matchFromStart > 0) {
                  // Add at END - merge with last matched word
                  const lastMatchedWord = newWords[newWords.length - 1];
                  const bundledText = lastMatchedWord.word + ' ' + editedMiddleWords.join(' ');
                  const bundledEndTime = seg.segmentEnd || originalWords[originalWords.length - 1].end;

                  // Replace the last word instead of popping
                  newWords[newWords.length - 1] = {
                    word: bundledText,
                    start: lastMatchedWord.start,
                    end: bundledEndTime,
                    confidence: lastMatchedWord.confidence
                  };

                } else if (matchFromStart === 0 && matchFromEnd === 0) {
                  // Complete rewrite
                  const firstOriginalWord = originalWords[0];
                  const bundledEndTime = seg.segmentEnd || originalWords[originalWords.length - 1].end;

                  newWords.push({
                    word: editedMiddleWords.join(' '),
                    start: firstOriginalWord.start,
                    end: bundledEndTime,
                    confidence: 1.0
                  });

                } else {
                  // Add in MIDDLE - merge with NEXT matched word
                  const nextWord = originalWords[originalWords.length - matchFromEnd];
                  const nextEditedWord = editedWords[editedWords.length - matchFromEnd];
                  const bundledText = editedMiddleWords.join(' ') + ' ' + nextEditedWord;

                  newWords.push({
                    word: bundledText,
                    start: nextWord.start,
                    end: nextWord.end,
                    confidence: nextWord.confidence
                  });

                  skipFirstEndWord = true;
                }

              } else {
                // REPLACE WITH MORE (have originals to map, plus extras to merge)
                // Map first N edited words 1:1 with originals
                for (let i = 0; i < numToMap; i++) {
                  newWords.push({
                    word: editedMiddleWords[i],
                    start: originalMiddleWords[i].start,
                    end: originalMiddleWords[i].end,
                    confidence: originalMiddleWords[i].confidence
                  });
                }

                // Merge remaining extras with adjacent matched word
                const remaining = editedMiddleWords.slice(numToMap).join(' ');

                if (matchFromEnd > 0) {
                  // There are matched words at the END - merge extras with NEXT word
                  const nextWord = originalWords[originalWords.length - matchFromEnd];
                  const nextEditedWord = editedWords[editedWords.length - matchFromEnd];

                  newWords.push({
                    word: remaining + ' ' + nextEditedWord,
                    start: nextWord.start,
                    end: nextWord.end,
                    confidence: nextWord.confidence
                  });

                  skipFirstEndWord = true;

                } else {
                  // No matched words at END - merge with last mapped word
                  const lastWord = newWords[newWords.length - 1];
                  newWords[newWords.length - 1] = {
                    word: lastWord.word + ' ' + remaining,
                    start: lastWord.start,
                    end: seg.segmentEnd || originalWords[originalWords.length - 1].end,
                    confidence: lastWord.confidence
                  };
                }
              }

            } else {
              console.log('🔄 Operation: REPLACEMENT (same or fewer words)');
              console.log(`  - Mapping ${editedMiddleWords.length} words 1:1 with original timestamps`);
              if (editedRegionSize < originalRegionSize) {
                console.log(`  - Skipping ${originalRegionSize - editedRegionSize} deleted words`);
              }
              // REPLACEMENT - same or fewer words
              // Map 1:1 for all edited words (remaining originals are skipped/deleted)
              for (let i = 0; i < editedMiddleWords.length; i++) {
                newWords.push({
                  word: editedMiddleWords[i],
                  start: originalMiddleWords[i].start,
                  end: originalMiddleWords[i].end,
                  confidence: originalMiddleWords[i].confidence
                });
              }
            }
          }

          // Add unchanged words from END
          const startIndexForEnd = originalWords.length - matchFromEnd + (skipFirstEndWord ? 1 : 0);
          for (let i = startIndexForEnd; i < originalWords.length; i++) {
            const editedIndex = editedWords.length - matchFromEnd + (i - startIndexForEnd) + (skipFirstEndWord ? 1 : 0);
            newWords.push({
              ...originalWords[i],
              word: editedWords[editedIndex]  // Use edited version (preserves punctuation changes)
            });
          }

          const updatedSegment = {
            ...seg,
            words: newWords,
            text: deriveTextFromWords(newWords)
          };

          console.log('✅ RESULT:');
          console.log('  - Final text:', updatedSegment.text);
          console.log('  - Final words array:', updatedSegment.words);
          console.log('  - Word breakdown:');
          updatedSegment.words.forEach((w, i) => {
            console.log(`    [${i}] "${w.word}" → ${w.start}s-${w.end}s`);
          });
          console.log('═══════════════════════════════════════════════\n');

          return updatedSegment;
        }
        return seg;
      })
    );
    setEditingSegmentId(null);
    setEditedSegmentText('');
  };

  const cancelSegmentEdit = () => {
    setEditingSegmentId(null);
    setEditedSegmentText('');
  };

  // Speaker name editing
  const startEditingSpeaker = (speakerId: string, currentName: string) => {
    setEditingSpeakerId(speakerId);
    setEditedSpeakerName(currentName);
  };

  const saveSpeakerName = (speakerId: string) => {
    if (!editedSpeakerName.trim()) {
      cancelSpeakerEdit();
      return;
    }

    // Update speaker name in speakerColors
    setSpeakerColors(prev => ({
      ...prev,
      [speakerId]: {
        ...prev[speakerId],
        name: editedSpeakerName.trim()
      }
    }));

    // Update all transcript segments that use this speaker
    setTranscript(prev =>
      prev.map(seg => {
        if (seg.speaker.name === speakerColors[speakerId].name) {
          return {
            ...seg,
            speaker: {
              ...seg.speaker,
              name: editedSpeakerName.trim()
            }
          };
        }
        return seg;
      })
    );

    cancelSpeakerEdit();
  };

  const cancelSpeakerEdit = () => {
    setEditingSpeakerId(null);
    setEditedSpeakerName('');
  };

  // Find & Replace functionality
  const TRAILING_PUNCT = /([.,!?;:")\]]+)$/;

  const splitTrailingPunct = (w: string): [string, string] => {
    const m = w.match(TRAILING_PUNCT);
    return m ? [w.slice(0, w.length - m[1].length), m[1]] : [w, ''];
  };

  const wordMatches = (wordText: string, query: string): boolean => {
    const [base] = splitTrailingPunct(wordText);
    if (caseSensitive) return base === query;
    return base.toLowerCase() === query.toLowerCase();
  };

  const findAndReplaceAll = () => {
    if (!findText.trim()) return;

    let replacementCount = 0;

    setTranscript(prev =>
      prev.map(seg => {
        if (!seg.words || seg.words.length === 0) return seg;

        const newWords = seg.words.map(word => {
          if (!wordMatches(word.word, findText)) return word;
          const [, trailingPunct] = splitTrailingPunct(word.word);
          replacementCount++;
          return { ...word, word: replaceText + trailingPunct };
        });

        return { ...seg, words: newWords, text: deriveTextFromWords(newWords) };
      })
    );

    setShowFindReplace(false);
    setFindText('');
    setReplaceText('');
  };

  const countOccurrences = () => {
    if (!findText.trim()) return 0;
    let count = 0;
    transcript.forEach(seg => {
      seg.words?.forEach(word => {
        if (wordMatches(word.word, findText)) count++;
      });
    });
    return count;
  };

  const exportTranscript = () => {
    // Build header
    const title = transcriptTitle || "Transcript";
    const date = formatDisplayDate(completedDate);
    const speakerCount = speakerStats.length;

    // Calculate total duration
    const lastSegment = transcript[transcript.length - 1];
    const totalDuration = lastSegment?.segmentEnd
      ? formatTime(lastSegment.segmentEnd)
      : formatTime(lastSegment?.time || "0");

    let content = `TRANSCRIPT EXPORT\n`;
    content += `═══════════════════════════════════════════════════\n\n`;
    content += `Title: ${title}\n`;
    content += `Date: ${date}\n`;
    content += `Speakers: ${speakerCount}\n`;
    content += `Duration: ${totalDuration}\n\n`;
    content += `═══════════════════════════════════════════════════\n\n`;

    // Build transcript body
    transcript.forEach((segment) => {
      content += `[${segment.speaker.name}] [${segment.time}]\n`;
      content += `${segment.text}\n\n`;
    });

    // Create and download file
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/\s+/g, '_')}_Transcript.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Transform frontend segments to backend format (preserving word-level data)
  const transformSegmentsForBackend = (segments: TranscriptSegment[]): any[] => {
    return segments.map((segment) => {
      return {
        speaker: segment.speaker.name,
        start: segment.time,
        end: segment.segmentEnd || segment.time,
        text: segment.text,
        words: segment.words || []
      };
    });
  };

  const handleSave = async () => {
    if (!jobId) return;

    try {
      setIsSaving(true);
      const backendSegments = transformSegmentsForBackend(transcript);
      await updateTranscriptSegments(jobId, backendSegments);
    } catch (err) {
      console.error('Error saving transcript:', err);
      alert(err instanceof Error ? err.message : 'Failed to save transcript');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const confirmDeleteTranscript = async () => {
    if (!jobId) return;

    try {
      setIsDeleting(true);
      await deleteTranscript(jobId);
      navigate('/transcripts');
    } catch (err) {
      console.error('Error deleting transcript:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete transcript');
      setIsDeleting(false);
    }
  };

  const cancelDeleteTranscript = () => {
    setShowDeleteDialog(false);
  };

  const toggleStarred = async () => {
    if (!jobId || isTogglingStarred) return;

    try {
      setIsTogglingStarred(true);
      const newStarredValue = !isStarred;
      await updateTranscriptStarred(jobId, newStarredValue);
      setIsStarred(newStarredValue);
    } catch (err) {
      console.error('Error updating starred status:', err);
      alert(err instanceof Error ? err.message : 'Failed to update starred status');
    } finally {
      setIsTogglingStarred(false);
    }
  };

  const startEditingTranscriptTitle = () => {
    setIsEditingTitle(true);
    setEditedTitleValue(transcriptTitle);
  };

  const saveTranscriptTitle = async () => {
    if (!jobId || !editedTitleValue.trim()) {
      alert('Title cannot be empty');
      return;
    }

    try {
      await updateTranscriptTitle(jobId, editedTitleValue.trim());
      setTranscriptTitle(editedTitleValue.trim());
      setIsEditingTitle(false);
    } catch (err) {
      console.error('Error updating title:', err);
      alert(err instanceof Error ? err.message : 'Failed to update title');
    }
  };

  const cancelTitleEdit = () => {
    setIsEditingTitle(false);
    setEditedTitleValue('');
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTranscriptTitle();
    } else if (e.key === 'Escape') {
      cancelTitleEdit();
    }
  };

  const toggleSegmentSelection = (segmentId: string) => {
    setSelectedSegments(prev =>
      prev.includes(segmentId)
        ? prev.filter(id => id !== segmentId)
        : [...prev, segmentId]
    );
  };


  const initiateMerge = () => {
    if (selectedSegments.length < 2) {
      alert('Please select at least 2 segments to merge');
      return;
    }

    // Check if all selected segments are on current page
    const allOnCurrentPage = selectedSegments.every(id =>
      paginatedTranscript.some(seg => seg.id === id)
    );

    if (!allOnCurrentPage) {
      alert('All selected segments must be on the same page to merge. Please adjust your selection.');
      return;
    }

    // Check if selected segments are consecutive
    const selectedIndices = selectedSegments
      .map(id => transcript.findIndex(seg => seg.id === id))
      .sort((a, b) => a - b);

    const areConsecutive = selectedIndices.every((idx, i) => {
      if (i === 0) return true;
      return idx === selectedIndices[i - 1] + 1;
    });

    if (!areConsecutive) {
      alert('Please select consecutive segments to merge');
      return;
    }

    // Get unique speakers from selected segments
    const segmentsToMerge = selectedIndices.map(idx => transcript[idx]);
    const uniqueSpeakers = Array.from(
      new Set(segmentsToMerge.map(seg => seg.speaker.name))
    ).map(name => speakers.find(s => s.name === name)!);

    setMergeSpeakerOptions(uniqueSpeakers);
    setShowMergeDialog(true);
  };

  const confirmMerge = (selectedSpeaker: Speaker) => {
    if (selectedSegments.length < 2) return;

    const selectedIndices = selectedSegments
      .map(id => transcript.findIndex(seg => seg.id === id))
      .sort((a, b) => a - b);

    // Get the segments to merge
    const segmentsToMerge = selectedIndices.map(idx => transcript[idx]);

    // Use the first segment's time and selected speaker
    const firstSegment = segmentsToMerge[0];

    // Merge all words arrays from selected segments
    const mergedWords: Word[] = [];
    for (const segment of segmentsToMerge) {
      if (segment.words && segment.words.length > 0) {
        mergedWords.push(...segment.words);
      }
    }

    // Derive display text from merged words
    const mergedText = mergedWords.length > 0 ? deriveTextFromWords(mergedWords) : segmentsToMerge.map(seg => seg.text).join(' ');

    // Create new merged segment
    const mergedSegment: TranscriptSegment = {
      ...firstSegment,
      speaker: selectedSpeaker,
      text: mergedText,
      words: mergedWords.length > 0 ? mergedWords : undefined,
    };

    // Remove selected segments and insert merged one
    const newTranscript = transcript.filter(seg => !selectedSegments.includes(seg.id));
    newTranscript.splice(selectedIndices[0], 0, mergedSegment);

    // Auto-merge any consecutive same-speaker segments that may have been created
    const finalTranscript = mergeConsecutiveSpeakers(newTranscript);

    setTranscript(finalTranscript);
    setSelectedSegments([]);
    setShowMergeDialog(false);
  };

  const toggleSpeaker = (speakerName: string) => {
    setSelectedSpeakers(prev =>
      prev.includes(speakerName)
        ? prev.filter(s => s !== speakerName)
        : [...prev, speakerName]
    );
  };

  // Memoize filtered transcript to prevent unnecessary recalculations
  const filteredTranscript = useMemo(() => {
    let filtered = selectedSpeakers.length > 0
      ? transcript.filter(t => selectedSpeakers.includes(t.speaker.name))
      : transcript;

    // Apply search filter if search query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(segment =>
        segment.text.toLowerCase().includes(query) ||
        segment.speaker.name.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [transcript, selectedSpeakers, searchQuery]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredTranscript.length / SEGMENTS_PER_PAGE);

  // Get current page segments
  const paginatedTranscript = useMemo(() => {
    const startIdx = (currentPage - 1) * SEGMENTS_PER_PAGE;
    const endIdx = startIdx + SEGMENTS_PER_PAGE;
    return filteredTranscript.slice(startIdx, endIdx);
  }, [filteredTranscript, currentPage]);

  // Build segment-to-page mapping for audio sync
  const segmentPageMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredTranscript.forEach((segment, idx) => {
      const page = Math.floor(idx / SEGMENTS_PER_PAGE) + 1;
      map.set(segment.id, page);
    });
    return map;
  }, [filteredTranscript]);

  // Auto-navigate to page when active word changes
  useEffect(() => {
    if (!activeWordId) return;

    const segmentId = activeWordId.split('-word-')[0];
    const targetPage = segmentPageMap.get(segmentId);

    if (targetPage && targetPage !== currentPage) {
      setCurrentPage(targetPage);
    }
  }, [activeWordId, segmentPageMap, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedSpeakers, hideFillers]);

  // Clear selection when page changes in merge mode
  useEffect(() => {
    if (isMergeMode) {
      setSelectedSegments([]);
    }
  }, [currentPage, isMergeMode]);

  // Calculate low-confidence words whenever threshold or transcript changes
  const lowConfidenceMatches = useMemo(() => {
    if (!isConfidenceFilterActive) return [];

    const matches: Array<{ segmentId: string; wordIndex: number; confidence: number }> = [];

    filteredTranscript.forEach((segment) => {
      segment.words?.forEach((word, wordIndex) => {
        if (word.confidence < confidenceThreshold) {
          matches.push({
            segmentId: segment.id,
            wordIndex,
            confidence: word.confidence,
          });
        }
      });
    });

    return matches;
  }, [filteredTranscript, confidenceThreshold, isConfidenceFilterActive]);

  // Update state when matches change
  useEffect(() => {
    setLowConfidenceWords(lowConfidenceMatches);
    setCurrentLowConfidenceIndex(0);
  }, [lowConfidenceMatches]);

  // Navigation functions for confidence filter
  const navigateToNextLowConfidence = () => {
    if (lowConfidenceWords.length === 0) return;

    const nextIndex = (currentLowConfidenceIndex + 1) % lowConfidenceWords.length;
    setCurrentLowConfidenceIndex(nextIndex);

    const match = lowConfidenceWords[nextIndex];

    // Find which page contains this segment
    const segmentIdx = filteredTranscript.findIndex(seg => seg.id === match.segmentId);
    if (segmentIdx !== -1) {
      const targetPage = Math.floor(segmentIdx / SEGMENTS_PER_PAGE) + 1;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
    }

    // Set activeWordId to trigger scroll (delay for page render)
    setTimeout(() => {
      setActiveWordId(`${match.segmentId}-word-${match.wordIndex}`);
    }, 100);
  };

  const navigateToPrevLowConfidence = () => {
    if (lowConfidenceWords.length === 0) return;

    const prevIndex = currentLowConfidenceIndex === 0
      ? lowConfidenceWords.length - 1
      : currentLowConfidenceIndex - 1;
    setCurrentLowConfidenceIndex(prevIndex);

    const match = lowConfidenceWords[prevIndex];

    // Find which page contains this segment
    const segmentIdx = filteredTranscript.findIndex(seg => seg.id === match.segmentId);
    if (segmentIdx !== -1) {
      const targetPage = Math.floor(segmentIdx / SEGMENTS_PER_PAGE) + 1;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
    }

    // Set activeWordId to trigger scroll (delay for page render)
    setTimeout(() => {
      setActiveWordId(`${match.segmentId}-word-${match.wordIndex}`);
    }, 100);
  };

  const applyConfidenceFilter = () => {
    setIsConfidenceFilterActive(true);
    if (lowConfidenceMatches.length > 0) {
      // Jump to first match
      const firstMatch = lowConfidenceMatches[0];
      // Set activeWordId to trigger scroll
      setActiveWordId(`${firstMatch.segmentId}-word-${firstMatch.wordIndex}`);
    }
  };

  const clearConfidenceFilter = () => {
    setIsConfidenceFilterActive(false);
    setCurrentLowConfidenceIndex(0);
    setActiveWordId(null);
  };

  // Calculate speaker participation percentages by total word speaking time
  const speakerDurations = speakers.map(speaker => {
    const seconds = transcript
      .filter(t => t.speaker.name === speaker.name)
      .flatMap(t => t.words ?? [])
      .reduce((sum, w) => sum + (parseFloat(w.end) - parseFloat(w.start)), 0);
    return { ...speaker, seconds };
  });
  const totalSeconds = speakerDurations.reduce((sum, s) => sum + s.seconds, 0);
  const speakerStats = speakerDurations
    .map(speaker => ({
      ...speaker,
      percentage: totalSeconds > 0 ? Math.round((speaker.seconds / totalSeconds) * 100) : 0,
      count: transcript.filter(t => t.speaker.name === speaker.name).length,
    }))
    .filter(speaker => speaker.percentage > 0);

  // Calculate average confidence across all words
  const averageConfidence = useMemo(() => {
    let totalConfidence = 0;
    let wordCount = 0;

    transcript.forEach(segment => {
      if (segment.words && segment.words.length > 0) {
        segment.words.forEach(word => {
          totalConfidence += word.confidence;
          wordCount++;
        });
      }
    });

    if (wordCount === 0) return 0;
    return Math.round((totalConfidence / wordCount) * 100);
  }, [transcript]); // Hide speakers with 0%

  return (
    <div className="flex h-[calc(100vh-56px-64px)] bg-bg-dark">{/* 56px navbar + 64px audio player */}
      {/* Loading Overlay */}
      {pollingStatus === 'polling' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-bg-dark border border-border-gray rounded-xl p-8 max-w-md w-full mx-4 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary-teal mb-6 mx-auto" />
            <h3 className="text-xl font-bold text-text-primary mb-2">{statusMessage}</h3>
            <p className="text-sm text-text-secondary mb-6">
              This usually takes a few minutes
            </p>
            <button
              onClick={() => navigate('/transcripts')}
              className="bg-panel-dark border border-border-gray rounded-lg px-6 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary hover:border-primary-teal transition-all"
            >
              Go Back to Transcripts
            </button>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {pollingStatus === 'failed' && transcriptError && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-bg-dark border border-accent-red/50 rounded-xl p-8 max-w-md w-full mx-4 text-center">
            <AlertTriangle className="w-12 h-12 mb-6 text-accent-red" />
            <h3 className="text-xl font-bold text-text-primary mb-2">Transcription Error</h3>
            <p className="text-sm text-accent-red mb-6">{transcriptError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/transcripts')}
                className="flex-1 bg-panel-dark border border-border-gray rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all"
              >
                Go Back
              </button>
              <button
                onClick={() => navigate('/upload')}
                className="flex-1 bg-primary-teal rounded-lg px-4 py-2 text-sm font-semibold text-bg-dark hover:bg-[#0ea998] transition-all"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Left Sidebar */}
      <div className="w-[170px] bg-bg-dark border-r border-border-gray flex flex-col py-[22px] px-3.5">
        {/* New Upload Button */}
        <button
          onClick={() => window.location.href = '/upload'}
          className="w-full bg-primary-teal rounded-[9px] h-[38px] flex items-center justify-center gap-2 text-bg-dark font-semibold text-xs hover:bg-[#0ea998] transition-all"
        >
          <span className="w-[7px] h-[7px] bg-accent-red rounded-full"></span>
          New Upload
        </button>

        <div className="h-5"></div>

        {/* Library Section */}
        <p className="text-[9px] font-semibold text-text-muted tracking-[1.4px] mb-1">LIBRARY</p>

        <div className="space-y-1">
          <div
            onClick={() => navigate('/transcripts?starred=true')}
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-text-secondary hover:bg-panel-dark cursor-pointer"
          >
            <div className="w-[3px] h-3.5 bg-transparent rounded-sm"></div>
            <span className="text-xs">Starred</span>
          </div>
          <div
            onClick={() => navigate('/transcripts')}
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-text-secondary hover:bg-panel-dark cursor-pointer"
          >
            <div className="w-[3px] h-3.5 bg-transparent rounded-sm"></div>
            <span className="text-xs">All Transcripts</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-bg-dark border-b border-border-gray px-7 h-14 flex items-center justify-between">
          <div className="flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedTitleValue}
                  onChange={(e) => setEditedTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  className="bg-bg-dark border border-primary-teal rounded px-2 py-1 text-sm text-text-primary outline-none"
                  autoFocus
                />
                <button
                  onClick={saveTranscriptTitle}
                  className="text-xs px-2 py-1 bg-primary-teal text-bg-dark rounded hover:bg-[#0ea998]"
                >
                  Save
                </button>
                <button
                  onClick={cancelTitleEdit}
                  className="text-xs px-2 py-1 bg-panel-dark border border-border-gray text-text-secondary rounded hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h2 className="text-[17px] font-bold text-text-primary">{transcriptTitle}</h2>
                <button
                  onClick={startEditingTranscriptTitle}
                  className="text-text-secondary opacity-0 group-hover:opacity-100 hover:text-primary-teal transition-all"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleStarred}
              disabled={isTogglingStarred}
              className={`bg-panel-dark border border-border-gray rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:border-primary-teal ${
                isStarred ? 'text-yellow-400' : 'text-text-secondary'
              }`}
              title={isStarred ? 'Unstar transcript' : 'Star transcript'}
            >
              <StarIcon filled={isStarred} className="w-4 h-4" />
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-primary-teal rounded-lg px-3.5 py-1.5 text-xs font-semibold text-bg-dark hover:bg-[#0ea998] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleDeleteClick}
              className="bg-panel-dark border border-accent-red/40 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-accent-red/80 hover:text-accent-red hover:border-accent-red transition-all"
            >
              Delete
            </button>
            <button
              onClick={exportTranscript}
              className="bg-panel-dark border border-border-gray rounded-lg px-3.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-[#262629] transition-all"
            >
              Export
            </button>
          </div>
        </div>

        {/* Edit Toolbar */}
        <div className="bg-panel-dark border-b border-border-gray px-7 h-11 flex items-center gap-2">
          {/* Mode Selector - Show all 3 modes */}
          <div className="flex items-center gap-1 bg-bg-dark border border-border-gray rounded-lg p-1">
            <button
              onClick={() => {
                setIsEditMode(false);
                setIsMergeMode(false);
                setSelectedSegments([]);
              }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                !isEditMode && !isMergeMode
                  ? 'bg-primary-teal text-bg-dark'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              View Mode
            </button>
            <button
              onClick={() => {
                setIsEditMode(true);
                setIsMergeMode(false);
                setSelectedSegments([]);
              }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                isEditMode && !isMergeMode
                  ? 'bg-primary-teal text-bg-dark'
                  : 'text-white hover:text-text-primary'
              }`}
            >
              Edit Mode
            </button>
            <button
              onClick={() => {
                setIsEditMode(true);
                setIsMergeMode(true);
              }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                isMergeMode
                  ? 'bg-accent-red text-bg-dark'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Merge Mode
            </button>
          </div>

          {isMergeMode && selectedSegments.length >= 2 && (
            <button
              onClick={initiateMerge}
              className="bg-primary-teal rounded-[7px] px-3 py-1.5 text-xs font-semibold text-bg-dark hover:bg-[#0ea998] transition-all"
            >
              Merge {selectedSegments.length} Selected
            </button>
          )}

          {isMergeMode && selectedSegments.length > 0 && (
            <button
              onClick={() => setSelectedSegments([])}
              className="text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Clear Selection
            </button>
          )}

          {/* Confidence Filter Navigation Controls */}
          {isConfidenceFilterActive && lowConfidenceWords.length > 0 && (
            <>
              <div className="flex items-center gap-2 bg-bg-dark border border-border-gray rounded-lg px-3 py-1.5">
                <span className="text-[11px] text-text-muted">
                  Low Confidence: {currentLowConfidenceIndex + 1} / {lowConfidenceWords.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={navigateToPrevLowConfidence}
                    className="bg-panel-dark border border-border-gray rounded-md px-2 py-0.5 text-[11px] font-semibold text-text-primary hover:bg-[#262629] transition-all flex items-center gap-0.5"
                  >
                    <ChevronLeft className="w-3 h-3" />Prev
                  </button>
                  <button
                    onClick={navigateToNextLowConfidence}
                    className="bg-panel-dark border border-border-gray rounded-md px-2 py-0.5 text-[11px] font-semibold text-text-primary hover:bg-[#262629] transition-all flex items-center gap-0.5"
                  >
                    Next<ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <button
                onClick={clearConfidenceFilter}
                className="text-xs text-text-secondary hover:text-accent-red transition-colors"
              >
                Clear Filter
              </button>
            </>
          )}

          <div className="flex-1"></div>
          <button
            onClick={() => setShowConfidenceFilter(true)}
            className={`text-xs transition-colors ${
              isConfidenceFilterActive
                ? 'text-primary-teal font-semibold'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            ⚠ Confidence Filter
            {isConfidenceFilterActive && ` (${lowConfidenceWords.length})`}
          </button>
          <button
            onClick={() => setHideFillers(prev => !prev)}
            className={`text-xs transition-colors ${
              hideFillers
                ? 'text-primary-teal font-semibold'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {hideFillers ? '⊘ Fillers Hidden' : '⊘ Hide Fillers'}
          </button>
          <button
            onClick={() => setShowFindReplace(true)}
            className="text-xs text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1.5"
          >
            <Search className="w-3.5 h-3.5" />Find & Replace
          </button>
        </div>

        {/* Content with Transcript and Right Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Transcript Area */}
          <div className="flex-1 overflow-y-auto px-7 py-6">
            {/* Search Bar */}
            <div className="bg-panel-dark border border-border-gray rounded-lg px-3 h-9 flex items-center gap-2.5 mb-4">
              <Search className="w-4 h-4 text-text-muted shrink-0" />
              <input
                type="text"
                placeholder="Search transcript…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-text-muted hover:text-text-primary text-sm"
                >
                  ×
                </button>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-gray">
                <div className="text-xs text-text-secondary">
                  Page {currentPage} of {totalPages} •
                  Showing {paginatedTranscript.length} of {filteredTranscript.length} segments
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all flex items-center gap-0.5"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />Previous
                  </button>

                  <div className="px-4 py-1 rounded-md text-xs font-semibold bg-primary-teal text-bg-dark">
                    {currentPage}
                  </div>

                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all flex items-center gap-0.5"
                  >
                    Next<ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}

            <div className="h-4"></div>

            {/* Filter by Speaker */}
            <div className="flex items-center gap-2 mb-4">
              <p className="text-[11px] text-text-muted">Filter by speaker:</p>
              {speakers.map((speaker) => (
                <button
                  key={speaker.name}
                  onClick={() => toggleSpeaker(speaker.name)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[20px] border text-[11px] font-medium transition-opacity hover:opacity-100"
                  style={{
                    backgroundColor: `${speaker.colorHex}1A`,
                    borderColor: speaker.colorHex,
                    color: speaker.colorHex,
                    opacity: selectedSpeakers.includes(speaker.name) || selectedSpeakers.length === 0 ? 1 : 0.5,
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: speaker.colorHex }}
                  ></div>
                  {speaker.name}
                </button>
              ))}
            </div>

            <div className="h-px bg-border-gray mb-4"></div>

            {/* Transcript Segments */}
            {isLoadingTranscript ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-text-muted">Loading transcript...</div>
              </div>
            ) : (
            <div className="space-y-6">
              {paginatedTranscript.map((segment) => {
                const isSelected = selectedSegments.includes(segment.id);
                return (
                  <div
                    key={segment.id}
                    className={`flex gap-3.5 group rounded-lg transition-all ${
                      isSelected ? 'bg-primary-teal/5 border border-primary-teal px-3 py-2 -mx-3' : ''
                    }`}
                  >
                    {/* Checkbox for selection - only show in merge mode */}
                    {isMergeMode && (
                      <div className="flex items-start pt-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSegmentSelection(segment.id)}
                          className="w-3.5 h-3.5 rounded border-border-gray bg-panel-dark cursor-pointer accent-primary-teal"
                        />
                      </div>
                    )}

                    {/* Time + Indicator */}
                    <div className="flex flex-col items-center w-11 flex-shrink-0">
                      <p className="text-[10px] text-text-muted mb-1.5">{segment.time}</p>
                      <div
                        className="w-0.5 flex-1 rounded-full min-h-[36px]"
                        style={{ backgroundColor: segment.speaker.colorHex }}
                      ></div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-5.5">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <div
                          className="w-[7px] h-[7px] rounded-full"
                          style={{ backgroundColor: segment.speaker.colorHex }}
                        ></div>
                        <span
                          className="text-xs font-semibold"
                          style={{ color: segment.speaker.colorHex }}
                        >
                          {segment.speaker.name}
                        </span>

                        {/* Edit segment button - only show in edit mode */}
                        {isEditMode && !isMergeMode && editingSegmentId !== segment.id && (
                          <button
                            onClick={() => startEditingSegment(segment.id, segment.text)}
                            className="ml-auto text-text-muted text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:text-primary-teal flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" />Edit
                          </button>
                        )}
                      </div>

                      {editingSegmentId === segment.id ? (
                        <div className="space-y-2">
                          <textarea
                            ref={textareaRef}
                            value={editedSegmentText}
                            onChange={(e) => setEditedSegmentText(e.target.value)}
                            className="w-full bg-panel-dark border border-primary-teal rounded-lg px-3 py-2 text-sm text-text-primary leading-[23px] outline-none resize-none"
                            rows={3}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveSegmentEdit(segment.id)}
                              className="bg-primary-teal rounded-md px-3 py-1.5 text-xs font-semibold text-bg-dark hover:bg-[#0ea998]"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelSegmentEdit}
                              className="bg-panel-dark border border-border-gray rounded-md px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p
                          className="text-sm text-text-primary leading-[23px]"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (isEditMode && !isMergeMode) {
                              startEditingSegment(segment.id, segment.text);
                            }
                          }}
                        >
                          {segment.words && segment.words.length > 0 ? (
                            segment.words.map((word, wordIndex) => {
                              const wordId = `${segment.id}-word-${wordIndex}`;
                              const isActive = isWordActive(segment.id, wordIndex);
                              const needsSpaceBefore = wordIndex > 0 && !/^[.,!?;:'")\]]/.test(word.word);

                              // Check if word should be highlighted for low confidence
                              const isLowConfidence = isConfidenceFilterActive && word.confidence < confidenceThreshold || word.confidence == confidenceThreshold;
                              const isCurrentLowConfidence = isConfidenceFilterActive &&
                                lowConfidenceWords[currentLowConfidenceIndex]?.segmentId === segment.id &&
                                lowConfidenceWords[currentLowConfidenceIndex]?.wordIndex === wordIndex;

                              return (
                                <React.Fragment key={wordId}>
                                  {needsSpaceBefore && ' '}
                                  <span
                                    ref={isActive || isCurrentLowConfidence ? activeWordRef : null}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isEditMode && !isMergeMode) {
                                        handleWordClick(word.start);
                                      }
                                    }}
                                    className={`px-1 rounded inline-block ${
                                      isActive
                                        ? 'bg-primary-teal text-bg-dark'
                                        : isCurrentLowConfidence
                                        ? 'bg-yellow-500/30 text-text-primary border-2 border-yellow-500'
                                        : isLowConfidence
                                        ? 'bg-yellow-500/20 text-text-primary'
                                        : isEditMode && !isMergeMode
                                        ? 'cursor-text hover:bg-primary-teal/20 hover:text-primary-teal'
                                        : !isMergeMode
                                        ? 'cursor-pointer hover:bg-primary-teal/20 hover:text-primary-teal'
                                        : ''
                                    }`}
                                    title={isLowConfidence ? `Confidence: ${(word.confidence * 100).toFixed(1)}%` : undefined}
                                  >
                                    {word.word}
                                  </span>
                                </React.Fragment>
                              );
                            })
                          ) : (
                            <span className="text-text-secondary italic">
                              {segment.text || '(empty segment)'}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="w-[220px] bg-bg-dark border-l border-border-gray overflow-y-auto py-6 px-4">
            {/* Speakers Section */}
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-text-primary mb-3">Speakers</h3>
              <div className="space-y-4">
                {speakerStats.map((speaker) => {
                  // Find the speaker ID from speakerColors
                  const speakerId = Object.keys(speakerColors).find(
                    key => speakerColors[key].name === speaker.name
                  );
                  const isEditingSpeaker = editingSpeakerId === speakerId;

                  return (
                    <div key={speaker.name}>
                      <div className="flex items-center justify-between mb-1.5 group">
                        {isEditingSpeaker ? (
                          <input
                            ref={speakerInputRef}
                            type="text"
                            value={editedSpeakerName}
                            onChange={(e) => setEditedSpeakerName(e.target.value)}
                            onBlur={() => speakerId && saveSpeakerName(speakerId)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && speakerId) {
                                saveSpeakerName(speakerId);
                              } else if (e.key === 'Escape') {
                                cancelSpeakerEdit();
                              }
                            }}
                            className="text-xs font-medium bg-panel-dark border border-primary-teal rounded px-1.5 py-0.5 outline-none flex-1 mr-2"
                          />
                        ) : (
                          <p
                            onDoubleClick={() => speakerId && startEditingSpeaker(speakerId, speaker.name)}
                            className="text-xs font-medium text-text-primary cursor-pointer hover:text-primary-teal"
                            title="Double-click to edit name"
                          >
                            {speaker.name}
                          </p>
                        )}
                        <p className="text-[10px] text-text-secondary">{speaker.percentage}%</p>
                      </div>
                      {/* Progress Bar */}
                      <div className="w-full h-1.5 bg-border-gray rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${speaker.percentage}%`,
                            backgroundColor: speaker.colorHex,
                          }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recording Info Section */}
            <div>
              <h3 className="text-xs font-semibold text-text-primary mb-3">Recording Info</h3>
              <div className="space-y-2 text-xs">
                <div>
                  <p className="text-text-muted">{averageConfidence}% confidence</p>
                  <p className="text-text-muted">English (US)</p>
                </div>
                <div className="pt-2 border-t border-border-gray">
                  <p className="text-text-muted">Amazon Transcribe</p>
                </div>
                <div>
                  <p className="text-text-muted">Auto-transcribed</p>
                  <p className="text-text-muted">{formatDisplayDate(completedDate)}</p>
                  {(redactionStatus === 'COMPLETE' || redactionStatus === 'NEEDS_REVIEW') && (
                    <p className="text-text-muted">PHI redacted</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audio Player */}
      <AudioPlayer audioSrc={audioUrl || undefined} />

      {/* Merge Dialog */}
      {showMergeDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-dark border border-border-gray rounded-xl p-6 w-[400px]">
            <h3 className="text-lg font-bold text-text-primary mb-2">Select Speaker</h3>
            <p className="text-sm text-text-secondary mb-4">
              Choose which speaker should be assigned to the merged segment.
            </p>

            <div className="space-y-2 mb-6">
              {mergeSpeakerOptions.map((speaker) => (
                <button
                  key={speaker.name}
                  onClick={() => confirmMerge(speaker)}
                  className="w-full bg-panel-dark border border-border-gray rounded-lg px-4 py-3 flex items-center gap-3 hover:border-primary-teal hover:bg-panel-dark/80 transition-all"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: speaker.colorHex }}
                  ></div>
                  <span className="text-sm font-semibold text-text-primary">
                    {speaker.name}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setShowMergeDialog(false);
                setMergeSpeakerOptions([]);
              }}
              className="w-full bg-panel-dark border border-border-gray rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Find & Replace Dialog */}
      {showFindReplace && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-dark border border-border-gray rounded-xl p-6 w-[450px]">
            <h3 className="text-lg font-bold text-text-primary mb-4">Find & Replace</h3>

            <div className="space-y-4 mb-6">
              {/* Find Input */}
              <div>
                <label className="text-xs font-semibold text-text-primary mb-1.5 block">
                  Find
                </label>
                <input
                  ref={findInputRef}
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Enter text to find..."
                  className="w-full bg-panel-dark border border-border-gray rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary-teal"
                />
              </div>

              {/* Replace Input */}
              <div>
                <label className="text-xs font-semibold text-text-primary mb-1.5 block">
                  Replace with
                </label>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Enter replacement text..."
                  className="w-full bg-panel-dark border border-border-gray rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary-teal"
                />
              </div>

              {/* Case Sensitive Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="caseSensitive"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  className="w-4 h-4 rounded border-border-gray bg-panel-dark cursor-pointer accent-primary-teal"
                />
                <label htmlFor="caseSensitive" className="text-xs text-text-secondary cursor-pointer">
                  Case sensitive
                </label>
              </div>

              {/* Occurrence Count */}
              {findText && (
                <div className="text-xs text-text-secondary">
                  Found {countOccurrences()} occurrence(s)
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={findAndReplaceAll}
                disabled={!findText.trim()}
                className="flex-1 bg-primary-teal rounded-lg px-4 py-2 text-sm font-semibold text-bg-dark hover:bg-[#0ea998] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Replace All
              </button>
              <button
                onClick={() => {
                  setShowFindReplace(false);
                  setFindText('');
                  setReplaceText('');
                  setCaseSensitive(false);
                }}
                className="flex-1 bg-panel-dark border border-border-gray rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confidence Filter Modal */}
      {showConfidenceFilter && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-20">
          <div className="bg-panel-dark border border-border-gray rounded-lg w-[500px] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-gray">
              <h3 className="text-sm font-semibold text-text-primary">
                Confidence Score Filter
              </h3>
              <button
                onClick={() => setShowConfidenceFilter(false)}
                className="text-text-muted hover:text-text-primary text-lg"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Threshold Slider */}
              <div>
                
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-border-gray rounded-lg appearance-none cursor-pointer accent-primary-teal"
                  />
                  <div className="bg-bg-dark border border-border-gray rounded-md px-3 py-1.5 text-sm font-semibold text-text-primary min-w-[70px] text-center">
                    {(confidenceThreshold * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              {/* Preview count */}
              {isConfidenceFilterActive && (
                <div className="text-xs text-text-muted">
                  Found {lowConfidenceWords.length} {lowConfidenceWords.length === 1 ? 'word' : 'words'} below {(confidenceThreshold * 100).toFixed(0)}% confidence
                </div>
              )}

              {/* Info text */}
              <p className="text-xs text-text-muted">
                Words equal to or below this confidence threshold will be highlighted in yellow/orange. Use the navigation controls to review each one.
              </p>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => {
                    applyConfidenceFilter();
                    setShowConfidenceFilter(false);
                  }}
                  className="flex-1 bg-primary-teal rounded-md px-4 py-2 text-sm font-semibold text-bg-dark hover:bg-[#0ea998] transition-all"
                >
                  Apply Filter
                </button>
                {isConfidenceFilterActive && (
                  <button
                    onClick={() => {
                      clearConfidenceFilter();
                      setShowConfidenceFilter(false);
                    }}
                    className="bg-panel-dark border border-border-gray rounded-md px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setShowConfidenceFilter(false)}
                  className="bg-panel-dark border border-border-gray rounded-md px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-dark border border-border-gray rounded-xl p-6 w-[400px]">
            <h3 className="text-lg font-bold text-text-primary mb-2">Delete Transcript?</h3>
            <p className="text-sm text-text-secondary mb-6">
              This will permanently delete this transcript and all associated files. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={cancelDeleteTranscript}
                disabled={isDeleting}
                className="flex-1 bg-panel-dark border border-border-gray rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteTranscript}
                disabled={isDeleting}
                className="flex-1 bg-accent-red rounded-lg px-4 py-2 text-sm font-semibold text-bg-dark hover:bg-red-600 transition-all disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPage;
