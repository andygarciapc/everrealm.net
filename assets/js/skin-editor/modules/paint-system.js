// /assets/js/modules/paintSystem.js
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

function initPainting() {
  const canvas = document.getElementById('skinCanvas');
  const ctx = canvas.getContext('2d');
  const colorPicker = document.getElementById('colorPicker');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const loadBtn = document.getElementById('loadBtn');
  const loadInput = document.getElementById('loadInput');
  const toolButtons = document.querySelectorAll('.toolBtn');

  let painting = false;
  let currentTool = 'brush';

  // Setup
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Tool switching
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY)
    };
  }

  function handleToolAction(e) {
    const { x, y } = getMousePos(e);
    switch (currentTool) {
      case 'brush':
        ctx.fillStyle = colorPicker.value;
        ctx.fillRect(x, y, 1, 1);
        updateTexture();
        break;
      case 'picker':
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        colorPicker.value = rgbToHex(pixel[0], pixel[1], pixel[2]);
        currentTool = 'brush';
        break;
      case 'bucket':
        bucketFill(x, y, hexToRgb(colorPicker.value));
        updateTexture();
        break;
    }
  }

  canvas.addEventListener('mousedown', e => { painting = true; handleToolAction(e); });
  canvas.addEventListener('mouseup', () => (painting = false));
  canvas.addEventListener('mouseleave', () => (painting = false));
  canvas.addEventListener('mousemove', e => {
    if (painting && currentTool === 'brush') handleToolAction(e);
  });

  clearBtn.onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#aaaaaa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    updateTexture();
  };

  saveBtn.onclick = () => {
    const link = document.createElement('a');
    link.download = 'skin.png';
    link.href = canvas.toDataURL();
    link.click();
  };

  loadBtn.onclick = () => loadInput.click();
  loadInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateTexture();
    };
    img.src = URL.createObjectURL(file);
  };

  function bucketFill(x, y, fillColor) {
    const targetColor = ctx.getImageData(x, y, 1, 1).data;
    const width = canvas.width, height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const matchColor = i =>
      data[i] === targetColor[0] &&
      data[i + 1] === targetColor[1] &&
      data[i + 2] === targetColor[2] &&
      data[i + 3] === targetColor[3];

    const setColor = i => {
      data[i] = fillColor.r;
      data[i + 1] = fillColor.g;
      data[i + 2] = fillColor.b;
      data[i + 3] = 255;
    };

    const stack = [{ x, y }];
    while (stack.length) {
      const n = stack.pop();
      const idx = (n.y * width + n.x) * 4;
      if (!matchColor(idx)) continue;
      let west = n.x, east = n.x;
      while (west >= 0 && matchColor((n.y * width + west) * 4)) west--;
      while (east < width && matchColor((n.y * width + east) * 4)) east++;
      for (let i = west + 1; i < east; i++) {
        setColor((n.y * width + i) * 4);
        if (n.y > 0 && matchColor(((n.y - 1) * width + i) * 4))
          stack.push({ x: i, y: n.y - 1 });
        if (n.y < height - 1 && matchColor(((n.y + 1) * width + i) * 4))
          stack.push({ x: i, y: n.y + 1 });
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return { canvas, ctx };
}

function updateTexture() {
  // placeholder, viewer module will link to this canvas texture
}

export { initPainting, updateTexture };
