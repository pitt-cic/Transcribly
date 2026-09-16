import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listTranscriptsPaginated, deleteTranscript, updateTranscriptTitle, TranscriptJob } from '../services/transcriptService';
import StarIcon from '../components/StarIcon';
import { Search, Loader2, AlertTriangle, FileText, Pencil, Calendar, Users, AlignLeft, Clock, Trash2, ChevronRight, ChevronLeft } from 'lucide-react';

const TranscriptListPage = () => {
  const [transcripts, setTranscripts] = useState<TranscriptJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<string | null>(null);
  const [editingTitleJobId, setEditingTitleJobId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [showStarredOnly, setShowStarredOnly] = useState(searchParams.get('starred') === 'true');
  const [_allTranscripts, setAllTranscripts] = useState<TranscriptJob[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();
  const mountTimeRef = useRef(Date.now());

  const TRANSCRIPTS_PER_PAGE = 15;

  const loadTranscripts = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Load all transcripts (without pagination for now - we'll paginate in the UI)
      const data = await listTranscriptsPaginated(100, undefined);

      // Keep fetching until we have all transcripts
      let allFetched = data.transcripts;
      let token = data.nextToken;

      while (token) {
        const nextData = await listTranscriptsPaginated(100, token);
        allFetched = [...allFetched, ...nextData.transcripts];
        token = nextData.nextToken;
      }

      // Sort by uploaded_at descending (newest first)
      const sorted = allFetched.sort((a, b) => {
        const dateA = new Date(a.uploaded_at || 0).getTime();
        const dateB = new Date(b.uploaded_at || 0).getTime();
        return dateB - dateA; // Newest first
      });

      setAllTranscripts(sorted);
      setTranscripts(sorted);
    } catch (err) {
      console.error('Error loading transcripts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load transcripts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTranscripts();

    // Poll every 5 seconds: always within the first 30s (covers fresh uploads), then only while jobs are in-progress
    const intervalId = setInterval(() => {
      const withinInitialWindow = Date.now() - mountTimeRef.current < 30000;
      setAllTranscripts(current => {
        const hasInProgress = current.some(t => t.transcription_status === 'IN_PROGRESS' || t.transcription_status === 'TRANSCRIBING');
        if (hasInProgress || current.length === 0 || withinInitialWindow) {
          loadTranscripts();
        }
        return current;
      });
    }, 5000);

    return () => clearInterval(intervalId);
  }, []); // Empty dependency array - only run once on mount

  // Initialize page from URL
  useEffect(() => {
    const pageParam = searchParams.get('page');
    if (pageParam) {
      const page = parseInt(pageParam, 10);
      if (!isNaN(page) && page > 0) {
        setCurrentPage(page);
      }
    }
  }, [searchParams]);

  // Update URL when page changes
  useEffect(() => {
    if (currentPage > 1) {
      setSearchParams({ page: currentPage.toString() });
    } else {
      setSearchParams({});
    }
  }, [currentPage, setSearchParams]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds?: string) => {
    if (!seconds) return '–';
    const sec = parseFloat(seconds);
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDeleteClick = (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setJobToDelete(jobId);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!jobToDelete) return;

    try {
      setDeletingJobId(jobToDelete);
      await deleteTranscript(jobToDelete);
      setShowDeleteConfirm(false);
      setJobToDelete(null);
      await loadTranscripts();
    } catch (err) {
      console.error('Error deleting transcript:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete transcript');
    } finally {
      setDeletingJobId(null);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setJobToDelete(null);
  };

  const startEditingTitle = (jobId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleJobId(jobId);
    setEditedTitle(currentTitle);
  };

  const saveTitle = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!editedTitle.trim()) {
      alert('Title cannot be empty');
      return;
    }

    try {
      await updateTranscriptTitle(jobId, editedTitle.trim());
      setEditingTitleJobId(null);
      setTranscripts(prev => prev.map(t =>
        t.jobId === jobId ? { ...t, title: editedTitle.trim() } : t
      ));
    } catch (err) {
      console.error('Error updating title:', err);
      alert(err instanceof Error ? err.message : 'Failed to update title');
    }
  };

  const cancelTitleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleJobId(null);
    setEditedTitle('');
  };

  const handleTitleKeyDown = (jobId: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle(jobId, e as any);
    } else if (e.key === 'Escape') {
      cancelTitleEdit(e as any);
    }
  };

  const getStatusBadge = (status: string) => {
    // Handle undefined/null status
    if (!status) {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">
          Processing
        </span>
      );
    }

    switch (status) {
      case 'COMPLETED':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary-teal/20 text-primary-teal border border-primary-teal/30">
            Completed
          </span>
        );
      case 'IN_PROGRESS':
      case 'TRANSCRIBING':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">
            Processing
          </span>
        );
      case 'FAILED':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-accent-red/20 text-accent-red border border-accent-red/30">
            Failed
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">
            Processing
          </span>
        );
    }
  };

  const filteredTranscripts = transcripts.filter(transcript => {
    const matchesSearch = transcript.filename?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStarFilter = !showStarredOnly || transcript.starred === true;
    return matchesSearch && matchesStarFilter;
  });

  // Calculate pagination
  const totalPages = Math.ceil(filteredTranscripts.length / TRANSCRIPTS_PER_PAGE);

  // Get current page transcripts
  const paginatedTranscripts = filteredTranscripts.slice(
    (currentPage - 1) * TRANSCRIPTS_PER_PAGE,
    currentPage * TRANSCRIPTS_PER_PAGE
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, showStarredOnly]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-bg-dark px-6 pb-6 pt-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">My Transcripts</h1>
            <p className="text-text-secondary">View and manage your transcription history</p>
          </div>
          <button
            onClick={() => navigate('/upload')}
            className="bg-primary-teal rounded-lg px-6 py-3 text-bg-dark font-semibold hover:bg-[#0ea998] transition-all flex items-center gap-2"
          >
            <span>+</span>
            New Upload
          </button>
        </div>

        {/* Search Bar */}
        <div className="bg-panel-dark border border-border-gray rounded-lg px-4 h-12 flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-text-muted shrink-0" />
          <input
            type="text"
            placeholder="Search by filename..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => {
              const newValue = !showStarredOnly;
              setShowStarredOnly(newValue);
              if (newValue) {
                setSearchParams({ starred: 'true' });
              } else {
                setSearchParams({});
              }
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all flex items-center gap-2 ${
              showStarredOnly
                ? 'bg-primary-teal text-bg-dark'
                : 'bg-panel-dark border border-border-gray text-text-secondary hover:text-text-primary hover:border-primary-teal'
            }`}
          >
            <StarIcon filled={showStarredOnly} className="w-4 h-4" />
            {showStarredOnly ? 'Starred Only' : 'All Transcripts'}
          </button>
        </div>

        {/* Content */}
        {isLoading && transcripts.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-text-secondary" />
          </div>
        ) : error ? (
          <div className="bg-accent-red/10 border border-accent-red/30 rounded-lg p-8 text-center">
            <AlertTriangle className="w-10 h-10 mb-4 text-accent-red" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">Error Loading Transcripts</h3>
            <p className="text-text-secondary mb-4">{error}</p>
            <button
              onClick={loadTranscripts}
              className="bg-primary-teal rounded-lg px-6 py-2 text-bg-dark font-semibold hover:bg-[#0ea998] transition-all"
            >
              Try Again
            </button>
          </div>
        ) : paginatedTranscripts.length === 0 ? (
          <div className="bg-panel-dark border border-border-gray rounded-xl p-12 text-center">
            <FileText className="w-14 h-14 mb-4 text-text-muted" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">
              {searchQuery ? 'No transcripts found' : showStarredOnly ? 'No starred transcripts' : 'No transcripts yet'}
            </h3>
            <p className="text-text-secondary mb-6">
              {searchQuery
                ? 'Try a different search term'
                : showStarredOnly
                ? 'Star a transcript to find it here quickly'
                : 'Upload your first audio file to get started'}
            </p>
            {!searchQuery && !showStarredOnly && (
              <button
                onClick={() => navigate('/upload')}
                className="bg-primary-teal rounded-lg px-6 py-3 text-bg-dark font-semibold hover:bg-[#0ea998] transition-all"
              >
                Upload Audio File
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedTranscripts.map((transcript) => (
              <div
                key={transcript.jobId}
                className="bg-panel-dark border border-border-gray rounded-lg p-5 hover:border-primary-teal/50 transition-all group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => navigate(`/transcripts/${transcript.jobId}`, { state: { starred: transcript.starred || false } })}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {editingTitleJobId === transcript.jobId ? (
                        <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            onKeyDown={(e) => handleTitleKeyDown(transcript.jobId, e)}
                            className="flex-1 bg-bg-dark border border-primary-teal rounded px-2 py-1 text-sm text-text-primary outline-none"
                            autoFocus
                          />
                          <button
                            onClick={(e) => saveTitle(transcript.jobId, e)}
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
                        <>
                          <div className="flex items-center gap-2">
                            {transcript.starred && <StarIcon filled className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
                            <h3 className="text-base font-semibold text-text-primary truncate group-hover:text-primary-teal transition-colors">
                              {transcript.title || transcript.filename || `Transcript ${transcript.jobId.slice(0, 8)}`}
                            </h3>
                          </div>
                          <button
                            onClick={(e) => startEditingTitle(
                              transcript.jobId,
                              transcript.title || transcript.filename || `Transcript ${transcript.jobId.slice(0, 8)}`,
                              e
                            )}
                            className="text-xs text-text-muted opacity-0 group-hover:opacity-100 hover:text-primary-teal transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {getStatusBadge(transcript.transcription_status)}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-text-secondary">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(transcript.uploaded_at)}</span>
                      {transcript.speaker_count && (
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{transcript.speaker_count} {transcript.speaker_count === 1 ? 'Speaker' : 'Speakers'}</span>
                      )}
                      {transcript.word_count && (
                        <span className="flex items-center gap-1"><AlignLeft className="w-3 h-3" />{transcript.word_count.toLocaleString()} words</span>
                      )}
                      {transcript.duration_sec && (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(transcript.duration_sec)}</span>
                      )}
                    </div>
                    {transcript.transcription_status === 'FAILED' && transcript.error_msg && (
                      <p className="text-xs text-accent-red mt-2">
                        Error: {transcript.error_msg}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => handleDeleteClick(transcript.jobId, e)}
                      disabled={deletingJobId === transcript.jobId}
                      className="text-text-muted hover:text-accent-red transition-colors text-sm opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      title="Delete transcript"
                    >
                      {deletingJobId === transcript.jobId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                    <div className="text-text-muted group-hover:text-primary-teal transition-colors">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {!isLoading && !error && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              Page {currentPage} of {totalPages} • Showing {paginatedTranscripts.length} of {filteredTranscripts.length} transcripts
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />Previous
              </button>

              <div className="px-4 py-2 rounded-md text-xs font-semibold bg-primary-teal text-bg-dark">
                {currentPage}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all flex items-center gap-1"
              >
                Next<ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-2 rounded-md text-xs font-semibold bg-panel-dark border border-border-gray text-text-primary hover:border-primary-teal disabled:opacity-30 transition-all"
              >
                Last
              </button>
            </div>
          </div>
        )}


        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-bg-dark border border-border-gray rounded-xl p-6 w-[400px]">
              <h3 className="text-lg font-bold text-text-primary mb-2">Delete Transcript?</h3>
              <p className="text-sm text-text-secondary mb-6">
                This will permanently delete the transcript and all associated files. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={cancelDelete}
                  className="flex-1 bg-panel-dark border border-border-gray rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={!!deletingJobId}
                  className="flex-1 bg-accent-red rounded-lg px-4 py-2 text-sm font-semibold text-bg-dark hover:bg-red-600 transition-all disabled:opacity-50"
                >
                  {deletingJobId ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TranscriptListPage;
