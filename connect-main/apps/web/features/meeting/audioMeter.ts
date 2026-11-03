'use client';

/**
 * Audio meter and audio test utilities for Google Meet-style audio feedback.
 */

export interface AudioMeterController {
  stop: () => void;
}

/**
 * Attach an audio level analyzer to an audio track to provide real-time volume (0-100).
 */
export function createAudioMeter(
  audioTrack: MediaStreamTrack,
  onVolume: (volume: number) => void
): AudioMeterController {
  let isRunning = true;
  let audioContext: AudioContext | null = null;
  let animFrameId: number | null = null;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      return { stop: () => {} };
    }

    audioContext = new AudioContextClass();
    const sourceStream = new MediaStream([audioTrack]);
    const sourceNode = audioContext.createMediaStreamSource(sourceStream);
    const analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.4;
    sourceNode.connect(analyserNode);

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const checkVolume = () => {
      if (!isRunning) return;

      analyserNode.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      // Normalize 0-255 scale to 0-100 with sensitivity curve
      const volume = Math.min(100, Math.round((average / 128) * 100));
      onVolume(volume);

      animFrameId = requestAnimationFrame(checkVolume);
    };

    animFrameId = requestAnimationFrame(checkVolume);
  } catch (err) {
    console.warn('[AudioMeter] Could not initialize Web Audio analyzer:', err);
  }

  return {
    stop: () => {
      isRunning = false;
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      if (audioContext && audioContext.state !== 'closed') {
        try {
          audioContext.close();
        } catch {
          // ignore safe close
        }
        audioContext = null;
      }
    },
  };
}

/**
 * Play a pleasant 2-tone chime to test speaker audio output.
 */
export async function playSpeakerTestChime(sinkId?: string): Promise<void> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();

  // If setSinkId is supported on AudioContext
  if (sinkId && typeof (ctx as any).setSinkId === 'function') {
    try {
      await (ctx as any).setSinkId(sinkId);
    } catch {
      // safe fallback to default output
    }
  }

  const now = ctx.currentTime;

  // Tone 1: 523.25 Hz (C5)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(523.25, now);
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.25);

  // Tone 2: 659.25 Hz (E5)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(659.25, now + 0.2);
  gain2.gain.setValueAtTime(0.18, now + 0.2);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.2);
  osc2.stop(now + 0.55);

  setTimeout(() => {
    if (ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }, 800);
}
