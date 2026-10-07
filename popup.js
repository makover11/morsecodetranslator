// --- MORSE DICTIONARY ---
const morseCodeMap = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', '\'': '.----.', '!': '-.-.--',
    '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
    ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
    '"': '.-..-.', '$': '...-..-', '@': '.--.-.', ' ': '/'
};

const reverseMorseCodeMap = {};
for (const [key, value] of Object.entries(morseCodeMap)) {
    if (key !== ' ') reverseMorseCodeMap[value] = key;
}
reverseMorseCodeMap['/'] = ' ';
reverseMorseCodeMap['|'] = ' ';

// --- DOM ELEMENTS ---
const textInput = document.getElementById('text-input');
const morseInput = document.getElementById('morse-input');
const topLightbulb = document.getElementById('top-lightbulb');
const lightOpt = document.getElementById('light-opt');

// --- TRANSLATION LOGIC ---
function textToMorse(text) {
    return text.toUpperCase().split('').map(char => morseCodeMap[char] || '').filter(Boolean).join(' ');
}
function morseToText(morse) {
    return morse.trim().split(/\s+/).map(code => reverseMorseCodeMap[code] || '').join('').replace(/\s+/g, ' ');
}

let isTranslating = false;
textInput.addEventListener('input', (e) => {
    if (isTranslating) return;
    isTranslating = true;
    morseInput.value = textToMorse(e.target.value);
    isTranslating = false;
});
morseInput.addEventListener('input', (e) => {
    if (isTranslating) return;
    isTranslating = true;
    textInput.value = morseToText(e.target.value);
    isTranslating = false;
});

// URL Parsing (Fallback, usually empty in extension popups but useful for future-proofing)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('text')) {
    textInput.value = urlParams.get('text');
    textInput.dispatchEvent(new Event('input'));
} else if (urlParams.has('morse')) {
    morseInput.value = urlParams.get('morse');
    morseInput.dispatchEvent(new Event('input'));
}

// --- UI LOGIC ---
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

let isMorseLeft = false;
document.getElementById('swap-btn').addEventListener('click', () => {
    isMorseLeft = !isMorseLeft;
    document.getElementById('box-text').style.order = isMorseLeft ? 3 : 1;
    document.getElementById('box-morse').style.order = isMorseLeft ? 1 : 3;
});

document.getElementById('btn-clear').addEventListener('click', () => {
    textInput.value = '';
    morseInput.value = '';
    stopAudio();
});

document.getElementById('copy-text').addEventListener('click', () => {
    if (!textInput.value) return;
    navigator.clipboard.writeText(textInput.value).then(() => showToast('Plain text copied!'));
});
document.getElementById('clear-text').addEventListener('click', () => {
    textInput.value = '';
    morseInput.value = '';
    stopAudio();
});

document.getElementById('copy-morse').addEventListener('click', () => {
    if (!morseInput.value) return;
    navigator.clipboard.writeText(morseInput.value).then(() => showToast('Morse code copied!'));
});
document.getElementById('clear-morse').addEventListener('click', () => {
    textInput.value = '';
    morseInput.value = '';
    stopAudio();
});

// Optimized for browser extension context: Shares to the live web application
document.getElementById('btn-share').addEventListener('click', () => {
    const url = new URL('https://justmorsecodetranslator.com/');
    if (textInput.value) {
        url.searchParams.set('text', textInput.value);
    } else if (morseInput.value) {
        url.searchParams.set('morse', morseInput.value);
    }
    navigator.clipboard.writeText(url.toString()).then(() => showToast('Share link copied!'));
});

// Sliders
const updateSliderVal = (id, suffix) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(id.replace('-slider', '-val'));
    el.addEventListener('input', () => valEl.textContent = el.value + suffix);
};
updateSliderVal('speed-slider', ' wpm');
updateSliderVal('pitch-slider', ' Hz');
updateSliderVal('volume-slider', '%');

lightOpt.addEventListener('change', (e) => {
    if (e.target.checked) topLightbulb.classList.add('mode-on');
    else topLightbulb.classList.remove('mode-on');
});
lightOpt.dispatchEvent(new Event('change'));

// --- AUDIO ENGINE ---
let audioCtx = null;
let isPlaying = false;
let isPaused = false;
let audioEvents = [];
let totalDuration = 0;
let syncAnimationId = null;
let activeOscillators = [];

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function buildAudioEvents(morseString, wpm) {
    const dotDuration = 1.2 / wpm; 
    let events = [];
    let timeOffset = 0;
    const chars = morseString.split('');
    
    chars.forEach((char) => {
        if (char === '.') {
            events.push({ start: timeOffset, end: timeOffset + dotDuration, type: '.' });
            timeOffset += dotDuration * 2; 
        } else if (char === '-') {
            events.push({ start: timeOffset, end: timeOffset + dotDuration * 3, type: '-' });
            timeOffset += dotDuration * 4; 
        } else if (char === ' ') {
            timeOffset += dotDuration * 2; 
        } else if (char === '/' || char === '|') {
            timeOffset += dotDuration * 6; 
        }
    });
    return { events, totalDuration: timeOffset };
}

function scheduleAudioNodes(ctx, events, pitch, volume, type) {
    activeOscillators = [];
    const currentTime = ctx.currentTime;
    if (type === 'cw') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = pitch;
        
        gain.gain.setValueAtTime(0, Math.max(0, currentTime)); 
        
        events.forEach(ev => {
            gain.gain.setValueAtTime(0, Math.max(0, ev.start - 0.005));
            gain.gain.linearRampToValueAtTime(volume, ev.start);
            gain.gain.setValueAtTime(volume, ev.end - 0.005);
            gain.gain.linearRampToValueAtTime(0, ev.end);
        });
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(events.length ? events[0].start : currentTime);
        osc.stop(events.length ? events[events.length-1].end + 0.1 : currentTime + 0.1);
        activeOscillators.push(osc);
    } else if (type === 'telegraph') {
        events.forEach(ev => {
            scheduleClick(ctx, ev.start, pitch, volume);
            scheduleClick(ctx, ev.end, pitch, volume * 0.7); 
        });
    }
}

function scheduleClick(ctx, time, pitch, volume) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(10, time + 0.02);
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.02);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.03);
    activeOscillators.push(osc);
}

function setVisualState(isLighting) {
    if (isLighting) {
        topLightbulb.classList.add('lit');
    } else {
        topLightbulb.classList.remove('lit');
    }

    const boxes = document.querySelectorAll('#mc-translator-app .box');
    if (isLighting) {
        if (lightOpt.checked) {
            boxes.forEach(box => box.classList.add('tool-flash'));
        } else {
            boxes.forEach(box => box.classList.remove('tool-flash'));
        }
    } else {
        boxes.forEach(box => box.classList.remove('tool-flash'));
    }
}

function syncVisuals() {
    if (!isPlaying || isPaused) {
        if (isPlaying) {
            if (isPaused) {
                syncAnimationId = requestAnimationFrame(syncVisuals);
            }
        }
        return;
    }
    
    const ctx = getAudioCtx();
    if (ctx.state === 'running') {
        const t = ctx.currentTime;
        let isLighting = false;
        
        for (let i = 0; i < audioEvents.length; i++) {
            const ev = audioEvents[i];
            if (t >= ev.start) {
                if (t <= ev.end) {
                    isLighting = true;
                    if (!ev.vibrated) {
                        if (document.getElementById('vibrate-opt').checked) {
                            if (navigator.vibrate) {
                                navigator.vibrate((ev.end - t) * 1000);
                                ev.vibrated = true;
                            }
                        }
                    }
                    break;
                }
            }
        }
        
        setVisualState(isLighting);
        
        if (t > totalDuration) {
            stopAudio();
            if (document.getElementById('repeat-opt').checked) {
                setTimeout(playAudio, 500);
            }
        }
    }
    if (isPlaying) {
        if (!isPaused) {
            syncAnimationId = requestAnimationFrame(syncVisuals);
        }
    }
}

function playAudio() {
    const ctx = getAudioCtx();
    
    if (isPlaying) {
        if (isPaused) {
            ctx.resume();
            isPaused = false;
        }
        return;
    }
    
    const morse = morseInput.value;
    if (!morse.trim()) return;
    
    if (ctx.state === 'suspended') ctx.resume();
    
    const wpm = parseInt(document.getElementById('speed-slider').value);
    const pitch = parseInt(document.getElementById('pitch-slider').value);
    const volume = parseInt(document.getElementById('volume-slider').value) / 100;
    const soundType = document.getElementById('sound-type').value;
    const soundEnabled = document.getElementById('sound-opt').checked;
    
    const playbackStartTime = ctx.currentTime + 0.05;
    const data = buildAudioEvents(morse, wpm);
    totalDuration = playbackStartTime + data.totalDuration;
    
    audioEvents = data.events.map(ev => ({
        start: playbackStartTime + ev.start,
        end: playbackStartTime + ev.end,
        type: ev.type,
        vibrated: false
    }));
    
    if (soundEnabled) {
        scheduleAudioNodes(ctx, audioEvents, pitch, volume, soundType);
    }
    
    isPlaying = true;
    isPaused = false;
    syncVisuals();
}

function pauseAudio() {
    if (isPlaying) {
        if (!isPaused) {
            getAudioCtx().suspend();
            isPaused = true;
            setVisualState(false);
            if (navigator.vibrate) navigator.vibrate(0);
        }
    }
}

function stopAudio() {
    if (audioCtx) {
        try { audioCtx.suspend(); } catch(e){}
        activeOscillators.forEach(osc => { try { osc.stop(); osc.disconnect(); } catch(e){} });
        activeOscillators = [];
    }
    isPlaying = false;
    isPaused = false;
    cancelAnimationFrame(syncAnimationId);
    setVisualState(false);
    if (navigator.vibrate) navigator.vibrate(0);
}

document.getElementById('btn-play').addEventListener('click', playAudio);
document.getElementById('btn-pause').addEventListener('click', pauseAudio);
document.getElementById('btn-stop').addEventListener('click', stopAudio);

// --- WAV EXPORT ---
function bufferToWave(abuffer, len) {
    var numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample, offset = 0, pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

    for(i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
            view.setInt16(pos, sample, true); pos += 2;
        }
        offset++;
    }
    return new Blob([buffer], {type: "audio/wav"});
}

document.getElementById('btn-save').addEventListener('click', async () => {
    const morse = morseInput.value;
    if (!morse.trim()) return showToast("Nothing to save!");
    
    showToast("Generating Audio...");
    
    const wpm = parseInt(document.getElementById('speed-slider').value);
    const pitch = parseInt(document.getElementById('pitch-slider').value);
    const volume = parseInt(document.getElementById('volume-slider').value) / 100;
    const soundType = document.getElementById('sound-type').value;
    
    const data = buildAudioEvents(morse, wpm);
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100 * (data.totalDuration + 0.5), 44100);
    
    scheduleAudioNodes(offlineCtx, data.events, pitch, volume, soundType);
    
    const renderedBuffer = await offlineCtx.startRendering();
    const wav = bufferToWave(renderedBuffer, renderedBuffer.length);
    const url = URL.createObjectURL(wav);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'morse_code.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// --- iOS SILENT SWITCH NOTE ---
(function() {
    var ua = navigator.userAgent;
    var isIOS = /iPhone|iPad|iPod/.test(ua);
    var isIPadOS = false;
    if (ua.indexOf('Mac') !== -1) {
        if (navigator.maxTouchPoints > 1) {
            isIPadOS = true;
        }
    }
    if (isIOS || isIPadOS) {
        var note = document.getElementById('ios-note');
        if (note) {
            note.classList.add('visible');
        }
    }
})();
