/** Spoken coaching through the Web Speech API. Runs on the phone; no server. */
let unlocked = false;

/** iOS only allows speech after a user gesture: call this from a tap handler. */
export function unlockVoice(): void {
  if (unlocked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
  unlocked = true;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Google US English|Aria|Jenny/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang))
  );
}

export function say(text: string, enabled = true): void {
  if (!enabled || !text || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  u.pitch = 1;
  synth.speak(u);
}
