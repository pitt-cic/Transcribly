import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadMultipleAudioFiles } from '../services/s3Service';
import { pollForTranscriptCompletion } from '../services/transcriptService';
import { Music, Check, X, Loader2, Upload, FileText, Zap, Target, Shield } from 'lucide-react';

interface FileProgress {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'transcribing' | 'transcription-complete' | 'transcription-failed';
  error?: string;
  jobId?: string;
}

const UploadPage = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileProgress, setFileProgress] = useState<Map<string, FileProgress>>(new Map());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [deidentify, setDeidentify] = useState(false);
  const navigate = useNavigate();
  const pollingCancelledRef = useRef(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.m4a')
    );

    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      return;
    }

    setIsUploading(true);
    pollingCancelledRef.current = false; // Reset the ref at start of upload

    const initialProgress = new Map<string, FileProgress>();
    files.forEach(file => {
      initialProgress.set(file.name, {
        file,
        progress: 0,
        status: 'pending',
      });
    });
    setFileProgress(initialProgress);

    try {
      const results = await uploadMultipleAudioFiles(
        files,
        deidentify,
        (fileName, progress) => {
          setFileProgress(prev => {
            const updated = new Map(prev);
            const current = updated.get(fileName);
            if (current) {
              updated.set(fileName, {
                ...current,
                progress,
                status: 'uploading',
              });
            }
            return updated;
          });
        },
        (fileName, _key, jobId) => {
          setFileProgress(prev => {
            const updated = new Map(prev);
            const current = updated.get(fileName);
            if (current) {
              updated.set(fileName, {
                ...current,
                progress: 100,
                status: 'completed',
              });
            }
            return updated;
          });
          console.log(`Uploaded ${fileName} with jobId: ${jobId}`);
        },
        (fileName, error) => {
          setFileProgress(prev => {
            const updated = new Map(prev);
            const current = updated.get(fileName);
            if (current) {
              updated.set(fileName, {
                ...current,
                status: 'failed',
                error,
              });
            }
            return updated;
          });
        }
      );

      if (results.successful.length > 0) {
        console.log('Successfully uploaded files:', results.successful.map(r => `${r.fileName} (${r.jobId})`));
        setUploadComplete(true);

        // Start polling for transcription completion
        const pollingPromises = results.successful.map(async (result) => {
          try {
            // Update status to transcribing
            setFileProgress(prev => {
              const updated = new Map(prev);
              const current = updated.get(result.fileName);
              if (current) {
                updated.set(result.fileName, {
                  ...current,
                  status: 'transcribing',
                  jobId: result.jobId,
                });
              }
              return updated;
            });

            // Poll for completion
            console.log(`[UploadPage] Starting polling for ${result.fileName} (${result.jobId})`);
            const completedJob = await pollForTranscriptCompletion(
              result.jobId,
              (status) => {
                if (!pollingCancelledRef.current) {
                  console.log(`[UploadPage] Transcription status for ${result.fileName}: ${status}`);
                }
              }
            );

            console.log(`[UploadPage] Polling completed for ${result.fileName}:`, completedJob);

            console.log(`[UploadPage] pollingCancelledRef.current = ${pollingCancelledRef.current}`);
            if (pollingCancelledRef.current) {
              console.log(`[UploadPage] Polling was cancelled, not updating UI`);
              return;
            }

            // Mark as complete
            console.log(`[UploadPage] Updating status to transcription-complete for ${result.fileName}`);
            setFileProgress(prev => {
              const updated = new Map(prev);
              const current = updated.get(result.fileName);
              if (current) {
                console.log(`[UploadPage] Setting ${result.fileName} to transcription-complete`);
                updated.set(result.fileName, {
                  ...current,
                  status: 'transcription-complete',
                });
              } else {
                console.warn(`[UploadPage] Could not find ${result.fileName} in fileProgress map`);
              }
              return updated;
            });
          } catch (error) {
            if (pollingCancelledRef.current) return;
            console.error(`Transcription failed for ${result.fileName}:`, error);
            setFileProgress(prev => {
              const updated = new Map(prev);
              const current = updated.get(result.fileName);
              if (current) {
                updated.set(result.fileName, {
                  ...current,
                  status: 'transcription-failed',
                  error: error instanceof Error ? error.message : 'Transcription failed',
                });
              }
              return updated;
            });
          }
        });

        // Track all polling promises (optional: could await Promise.all(pollingPromises) if needed)
        Promise.all(pollingPromises).catch(err => {
          console.error('One or more polling operations failed:', err);
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingCancelledRef.current = true;
    };
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Check if all transcriptions are complete
  const allTranscriptionsComplete = uploadComplete && Array.from(fileProgress.values()).every(
    fp => fp.status === 'transcription-complete' || fp.status === 'transcription-failed'
  );

  const completedCount = Array.from(fileProgress.values()).filter(
    fp => fp.status === 'transcription-complete'
  ).length;

  const totalCount = files.length;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-bg-dark px-6 pb-6 pt-10">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Upload Audio Files</h1>
          <p className="text-text-secondary">Drop your audio files here or click to browse</p>
        </div>

        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
            isDragging
              ? 'border-primary-teal bg-primary-teal/10'
              : 'border-border-gray bg-panel-dark hover:border-primary-teal/50'
          }`}
        >
          <div className="flex flex-col items-center gap-4">
            {/* Upload Icon */}
            <div className="w-16 h-16 rounded-full bg-primary-teal/20 flex items-center justify-center">
              <Music className="w-8 h-8 text-primary-teal" />
            </div>

            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-1">
                {isDragging ? 'Drop your files here' : 'Drag and drop audio files'}
              </h3>
              <p className="text-sm text-text-secondary mb-4">
                Supports MP3, WAV, M4A, and other audio formats
              </p>

              <label className="inline-flex items-center gap-2 px-6 py-3 bg-primary-teal text-bg-dark font-semibold rounded-md cursor-pointer hover:bg-[#0ea998] transition-all hover:-translate-y-0.5">
                <span>Browse Files</span>
                <input
                  type="file"
                  multiple
                  accept="audio/*,.mp3,.wav,.m4a"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Selected Files ({files.length})
            </h3>
            <div className="space-y-3">
              {files.map((file, index) => {
                const progress = fileProgress.get(file.name);
                const status = progress?.status || 'pending';
                const uploadProgress = progress?.progress || 0;

                return (
                  <div
                    key={index}
                    className="bg-panel-dark border border-border-gray rounded-lg p-4 hover:border-primary-teal/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-md bg-primary-teal/20 flex items-center justify-center flex-shrink-0">
                          {(status === 'transcription-complete') && <Check className="w-5 h-5 text-primary-teal" />}
                          {(status === 'failed' || status === 'transcription-failed') && <X className="w-5 h-5 text-accent-red" />}
                          {(status === 'transcribing') && <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />}
                          {(status === 'completed') && <Upload className="w-5 h-5 text-yellow-500" />}
                          {(status === 'pending' || status === 'uploading') && <Music className="w-5 h-5 text-text-muted" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {formatFileSize(file.size)}
                            {status === 'uploading' && ` - Uploading ${uploadProgress}%`}
                            {status === 'completed' && ' - Uploaded'}
                            {status === 'transcribing' && ' - Transcribing...'}
                            {status === 'transcription-complete' && ' - Ready to View'}
                            {status === 'transcription-failed' && ' - Transcription Failed'}
                            {status === 'failed' && ' - Upload Failed'}
                          </p>
                        </div>
                      </div>
                      {!isUploading && (
                        <button
                          onClick={() => removeFile(index)}
                          className="ml-4 w-8 h-8 rounded-md bg-bg-dark border border-border-gray text-text-secondary hover:border-accent-red hover:text-accent-red transition-all flex items-center justify-center"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {status === 'uploading' && (
                      <div className="mt-2 w-full bg-bg-dark rounded-full h-1.5">
                        <div
                          className="bg-primary-teal h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    )}
                    {status === 'failed' && progress?.error && (
                      <p className="mt-2 text-xs text-accent-red">
                        {progress.error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* PHI Redaction Toggle — shown before upload starts */}
            {!uploadComplete && (
              <div className="mt-5 flex items-center gap-3 bg-panel-dark border border-border-gray rounded-lg px-5 py-3.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={deidentify}
                  onClick={() => setDeidentify(prev => !prev)}
                  disabled={isUploading}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                    deidentify ? 'bg-primary-teal' : 'bg-border-gray'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      deidentify ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <div>
                  <p className="text-sm font-medium text-text-primary">Redact PHI</p>
                  <p className="text-xs text-text-secondary">Automatically detect and redact HIPAA identifiers (names, dates, SSNs, etc.)</p>
                </div>
              </div>
            )}

            {/* Upload Button or View Transcripts Button */}
            {!uploadComplete ? (
              <button
                onClick={handleUpload}
                disabled={isUploading}
                className="mt-6 w-full py-4 bg-primary-teal text-bg-dark text-base font-semibold rounded-lg hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload & Transcribe {files.length} {files.length === 1 ? 'File' : 'Files'}
                  </>
                )}
              </button>
            ) : (
              <div className="mt-6 space-y-3">
                {/* Progress message */}
                <div className="bg-panel-dark border border-border-gray rounded-lg p-4 text-center">
                  <p className="text-sm text-text-primary font-medium mb-1">
                    {allTranscriptionsComplete
                      ? 'All transcriptions complete!'
                      : 'Transcribing your files...'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {completedCount} of {totalCount} completed
                  </p>
                </div>

                {/* View Transcripts button (shown when all complete) */}
                {allTranscriptionsComplete && (
                  <button
                    onClick={() => navigate('/transcripts')}
                    className="w-full py-4 bg-primary-teal text-bg-dark text-base font-semibold rounded-lg hover:bg-[#0ea998] transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    View Transcripts
                  </button>
                )}

                {/* Go to List button (always available) */}
                <button
                  onClick={() => navigate('/transcripts')}
                  className="w-full py-3 bg-panel-dark border border-border-gray text-text-secondary text-sm font-semibold rounded-lg hover:text-text-primary hover:border-primary-teal transition-all"
                >
                  Go to Transcript List
                </button>
              </div>
            )}
          </div>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
          <div className="bg-panel-dark border border-border-gray rounded-lg p-6">
            <Zap className="w-6 h-6 mb-3 text-primary-teal" />
            <h4 className="font-semibold text-text-primary mb-1">Fast Processing</h4>
            <p className="text-sm text-text-secondary">Get your transcripts in minutes</p>
          </div>
          <div className="bg-panel-dark border border-border-gray rounded-lg p-6">
            <Target className="w-6 h-6 mb-3 text-primary-teal" />
            <h4 className="font-semibold text-text-primary mb-1">High Accuracy</h4>
            <p className="text-sm text-text-secondary">AI-powered speech recognition</p>
          </div>
          <div className="bg-panel-dark border border-border-gray rounded-lg p-6">
            <Shield className="w-6 h-6 mb-3 text-primary-teal" />
            <h4 className="font-semibold text-text-primary mb-1">Secure & Private</h4>
            <p className="text-sm text-text-secondary">Your data is encrypted and safe</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadPage;
