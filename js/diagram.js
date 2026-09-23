const viewport = document.querySelector('#diagram-viewport');
const diagram = document.querySelector('#architecture-diagram');
const zoomOut = document.querySelector('#diagram-zoom-out');
const zoomIn = document.querySelector('#diagram-zoom-in');
const fit = document.querySelector('#diagram-fit');
const status = document.querySelector('#diagram-scale');
let scale = 1;

function setScale(next) {
  const previous = scale;
  scale = Math.max(1, Math.min(3, next));
  const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
  const centerY = viewport.scrollTop + viewport.clientHeight / 2;
  diagram.style.width = `${scale * 100}%`;
  viewport.scrollLeft = scale === 1 ? 0 : centerX * scale / previous - viewport.clientWidth / 2;
  viewport.scrollTop = scale === 1 ? 0 : centerY * scale / previous - viewport.clientHeight / 2;
  zoomOut.disabled = scale === 1;
  zoomIn.disabled = scale === 3;
  status.textContent = `${Math.round(scale * 100)}%`;
}

zoomOut.addEventListener('click', () => setScale(scale - 0.5));
zoomIn.addEventListener('click', () => setScale(scale + 0.5));
fit.addEventListener('click', () => setScale(1));
viewport.addEventListener('keydown', (event) => {
  if (event.key === '+' || event.key === '=') { event.preventDefault(); setScale(scale + 0.5); }
  if (event.key === '-') { event.preventDefault(); setScale(scale - 0.5); }
  if (event.key === '0') { event.preventDefault(); setScale(1); }
});
document.querySelector('#diagram-controls').hidden = false;
