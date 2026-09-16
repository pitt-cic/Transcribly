import { useEffect, useState } from 'react';
import PlayIcon from '../assets/Play.svg';
import PauseIcon from '../assets/Pause.png';
import SkipForwardIcon from '../assets/Skip forward.svg';
import SkipBackwardIcon from '../assets/Skip backward.svg';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

interface AudioPlayerProps {
  audioSrc?: string;
}

const AudioPlayer = ({ audioSrc = '/audio/audio1.mp3' }: AudioPlayerProps) => {
  const {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setPlaybackRate,
  } = useAudioPlayer();

  // Format time in HH:MM:SS or MM:SS format
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Generate static waveform bars once (memoized to prevent regeneration)
  const [waveformBars] = useState(() =>
    Array.from({ length: 100 }, () => ({
      height: Math.random() * 60 + 20, // Random height between 20-80%
    }))
  );

  // Reset player when audio source changes
  useEffect(() => {
    const audio = audioRef?.current;
    if (audio) {
      audio.currentTime = 0;
    }
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [audioSrc]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioRef, setDuration, setIsPlaying]);

  // Smooth progress update using hybrid approach: timeupdate + RAF
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;

    let animationFrameId: number;
    let lastUpdateTime = 0;
    let lastSetTime = 0;

    // Listen to timeupdate for accuracy (fires ~4 times per second)
    const handleTimeUpdate = () => {
      const now = performance.now();
      // Throttle to 60fps (16ms intervals)
      if (now - lastSetTime < 16) {
        lastUpdateTime = now; // Update timing but don't trigger render
        return;
      }

      setCurrentTime(audio.currentTime);
      lastUpdateTime = now;
      lastSetTime = now;
    };

    // Use RAF for smooth visual updates between timeupdate events
    const updateProgress = () => {
      const now = performance.now();
      // Only update via RAF if no timeupdate in last 16ms (enables 60fps updates)
      if (now - lastUpdateTime > 16 && now - lastSetTime >= 16) {
        setCurrentTime(audio.currentTime);
        lastSetTime = now;
      }
      animationFrameId = requestAnimationFrame(updateProgress);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(updateProgress);
    }

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [audioRef, isPlaying, setCurrentTime]);

  // Play/Pause toggle
  const togglePlayPause = () => {
    const audio = audioRef?.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  // Skip forward 10 seconds
  const skipForward = () => {
    const audio = audioRef?.current;
    if (!audio) return;
    audio.currentTime = Math.min(audio.currentTime + 10, duration);
  };

  // Skip backward 10 seconds
  const skipBackward = () => {
    const audio = audioRef?.current;
    if (!audio) return;
    audio.currentTime = Math.max(audio.currentTime - 10, 0);
  };

  // Change playback speed
  const cyclePlaybackSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 0.75];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackRate(nextSpeed);
    if (audioRef?.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  // Seek to specific time
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef?.current;
    if (!audio || duration === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    audio.currentTime = percentage * duration;
  };

  return (
    <>
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioSrc} preload="metadata" />

      <div className="fixed bottom-0 left-0 right-0 bg-[#0A0A0B] border-t border-[#1F1F23] h-14 flex items-center px-4 z-50">
        <div className="flex items-center justify-between w-full max-w-screen-2xl mx-auto">
          {/* Left: Controls + Current Time */}
          <div className="flex items-center gap-3">
            {/* Playback Controls */}
            <div className="flex items-center gap-1.5">
              {/* Skip Backward Button */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-text-muted font-semibold mb-0.5">10s</span>
                <button
                  onClick={skipBackward}
                  className="w-8 h-8 flex items-center justify-center hover:opacity-70"
                >
                  <img src={SkipBackwardIcon} alt="Skip backward" className="w-6 h-6" />
                </button>
              </div>

              {/* Play/Pause Button */}
              <button
                onClick={togglePlayPause}
                className="w-8 h-8 flex items-center justify-center hover:opacity-70 mt-[13px]"
              >
                <img
                  src={isPlaying ? PauseIcon : PlayIcon}
                  alt={isPlaying ? 'Pause' : 'Play'}
                  className="w-6 h-6"
                />
              </button>

              {/* Skip Forward Button */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-text-muted font-semibold mb-0.5">10s</span>
                <button
                  onClick={skipForward}
                  className="w-8 h-8 flex items-center justify-center hover:opacity-70"
                >
                  <img src={SkipForwardIcon} alt="Skip forward" className="w-6 h-6" />
                </button>
              </div>

              {/* Playback Speed */}
              <button
                onClick={cyclePlaybackSpeed}
                className="px-2.5 py-1 text-[10px] font-semibold text-text-secondary hover:text-white hover:bg-white/5 rounded ml-1"
              >
                {playbackRate}x
              </button>
            </div>
          </div>

          {/* Center: Waveform + Total Time */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">

          {/* Current Time */}
            <div className="text-[10px] font-semibold text-primary-teal">
              {formatTime(currentTime)}
            </div>

            <div
              onClick={handleWaveformClick}
              className="w-[600px] h-6 cursor-pointer relative overflow-hidden"
            >
              {/* Base waveform (gray) */}
              <div className="absolute inset-0 flex items-center gap-[1px]">
                {waveformBars.map((bar, index) => (
                  <div
                    key={index}
                    className="flex-1 rounded-[1px] bg-[#3F3F46]"
                    style={{
                      height: `${bar.height}%`,
                    }}
                  />
                ))}
              </div>

              {/* Progress overlay (teal) */}
              <div
                className="absolute inset-0 flex items-center gap-[1px]"
                style={{
                  clipPath: `inset(0 ${100 - progress}% 0 0)`,
                }}
              >
                {waveformBars.map((bar, index) => (
                  <div
                    key={index}
                    className="flex-1 rounded-[1px] bg-primary-teal"
                    style={{
                      height: `${bar.height}%`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Total Time */}
            <div className="text-[10px] font-semibold text-[#6B6B70]">
              {formatTime(duration)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default AudioPlayer;
