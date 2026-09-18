import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';

export function Hero() {
  const [isTranscribing, setIsTranscribing] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTranscribing(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-grid pt-16">
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[var(--color-accent-primary)] opacity-[0.08] blur-[120px] rounded-full" />

      <div className="container relative z-10 text-center px-6 py-20">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="mb-6"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-bg-card)] border border-[var(--color-border-accent)] text-sm text-[var(--color-text-secondary)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent-primary)] animate-pulse" />
            AI-Powered Audio Transcription
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
          className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6"
        >
          Transcribe Audio.
          <br />
          <span className="text-gradient">Protect Privacy.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className="text-lg md:text-xl text-[var(--color-text-secondary)] max-w-2xl mx-auto mb-10"
        >
          Serverless multi-speaker transcription with automatic speaker diarization and HIPAA-compliant PHI redaction — powered by AWS Transcribe and Claude on Amazon Bedrock.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
        >
          <a href="#demo" className="btn-primary">
            Watch Demo
          </a>
          <a
            href="#architecture"
            className="px-6 py-3 rounded-xl border border-[var(--color-border-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)] transition-colors"
          >
            View Architecture
          </a>
        </motion.div>

        {/* Upload → Transcribe Visual */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
          className="max-w-4xl mx-auto"
        >
          <div className="glow-card p-6 md:p-8 text-left">
            {/* Upload Section */}
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--color-accent-primary)] to-[var(--color-accent-dark)] flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Uploaded Recording</p>
                <p className="text-[var(--color-text-primary)] font-medium mb-1">
                  participant_04_sleep_study.mp3 — 38 min
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Speakers: <span className="text-[var(--color-accent-primary)]">Auto-detect</span> •
                  Format: <span className="text-[var(--color-accent-primary)]">MP3</span>
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-accent-primary)]/30 to-transparent" />
            </div>

            {/* Loading or Generated Output */}
            <AnimatePresence mode="wait">
              {isTranscribing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 rounded-full border-2 border-[var(--color-accent-primary)]/30 border-t-[var(--color-accent-primary)]"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Processing Audio</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">AWS Transcribe is diarizing speakers...</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="output"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent-primary)]">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-[var(--color-text-tertiary)] mb-3">Transcript</p>
                      <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 mb-3 space-y-3">
                        <div>
                          <span className="text-xs font-semibold text-[var(--color-accent-primary)]">Researcher</span>
                          <span className="text-xs text-[var(--color-text-tertiary)] ml-2">0:02:14</span>
                          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                            You mentioned your sleep quality changed after starting the new shift schedule. Can you describe what that looked like in the first few weeks?
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold" style={{ color: '#F27F37' }}>Participant</span>
                          <span className="text-xs text-[var(--color-text-tertiary)] ml-2">0:02:29</span>
                          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                            Yeah, it was rough. I was falling asleep around 3 AM but still waking up at 7 out of habit. By week two I was running on maybe four hours most nights.
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-[var(--color-accent-primary)]">Researcher</span>
                          <span className="text-xs text-[var(--color-text-tertiary)] ml-2">0:02:51</span>
                          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                            And did that affect your performance at work, or was it more the day-to-day things outside of it?
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--color-accent-primary)]">
                          <path d="M9 11l3 3L22 4" />
                          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                        </svg>
                        <span>2 speakers detected · transcript ready</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
