// Dev-only stand-ins (see vite.config.js) used while the real module is missing.
export function createRenderer(canvas) {
  const g = canvas.getContext('2d')
  return {
    camera: {}, render() { canvas.width = innerWidth; canvas.height = innerHeight; const f = g.createLinearGradient(0, 0, innerWidth, innerHeight); f.addColorStop(0, '#0d2a5c'); f.addColorStop(1, '#4a2208'); g.fillStyle = f; g.fillRect(0, 0, innerWidth, innerHeight) },
    onEvent() {}, setCameraMode() {}, toggleBallCam() {}, setQuality() {}, resize() {}, dispose() {},
  }
}
export function createCarPreview() { return { setBody() {}, setTeam() {}, dispose() {} } }
