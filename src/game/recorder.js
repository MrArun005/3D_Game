/**
 * Records the WebGL canvas straight to WebM with MediaRecorder.
 * The colour grade is rendered into the canvas (see core/grade.js), so what is
 * captured matches what is on screen.
 */
export class Recorder {
  constructor(canvas, { fps = 30, bitrate = 12_000_000 } = {}) {
    this.canvas = canvas;
    this.fps = fps;
    this.bitrate = bitrate;
    this.chunks = [];
    this.recorder = null;
  }

  static supported() {
    return typeof MediaRecorder !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  start() {
    const stream = this.canvas.captureStream(this.fps);
    const preferred = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((t) => MediaRecorder.isTypeSupported(t));
    if (!preferred) throw new Error('no webm encoder available');

    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: preferred, videoBitsPerSecond: this.bitrate,
    });
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(200);
    return preferred;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder) return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: 'video/webm' }));
      this.recorder.stop();
      this.recorder = null;
    });
  }

  static download(blob, name = 'nightfall-drive.webm') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  static async toBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
}
