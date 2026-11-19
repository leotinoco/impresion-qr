(() => {
  'use strict';

  const MM_TO_PT = 72 / 25.4;
  const CARDS_PER_PAGE = 3;

  const PAGE_SIZES = {
    letter: { width: 792, height: 612, label: 'Carta Horizontal' },
    a4: { width: 841.89, height: 595.28, label: 'A4 Horizontal' },
  };

  // Defaults calibrated to the exact reference PDF (US Letter Landscape, 3×2, 180° top row)
  const DEFAULT_SETTINGS = {
    pageSize: 'letter',
    verticalAlign: 'top',
    marginXMm: 12.7,
    marginTopMm: 12.7,
    colGapMm: 1.2,
    rowGapMm: 3.5,
    showGuides: false,
  };

  const state = {
    items: [], // { id, sourceId, name, displayName, file, objectUrl }
    settings: { ...DEFAULT_SETTINGS },
    nextId: 1,
    dragIndex: null,
    busy: false,
  };

  // DOM References
  const el = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    btnSelectFiles: document.getElementById('btnSelectFiles'),
    outputName: document.getElementById('outputName'),
    summaryPill: document.getElementById('summaryPill'),
    countBadge: document.getElementById('countBadge'),
    queueEmpty: document.getElementById('queueEmpty'),
    queueList: document.getElementById('queueList'),
    btnSortAZ: document.getElementById('btnSortAZ'),
    btnClearAll: document.getElementById('btnClearAll'),
    btnGenerate: document.getElementById('btnGenerate'),
    btnGenerateLabel: document.getElementById('btnGenerateLabel'),
    btnPrint: document.getElementById('btnPrint'),
    pageSize: document.getElementById('pageSize'),
    verticalAlign: document.getElementById('verticalAlign'),
    colGapMm: document.getElementById('colGapMm'),
    rowGapMm: document.getElementById('rowGapMm'),
    showGuides: document.getElementById('showGuides'),
    btnResetSettings: document.getElementById('btnResetSettings'),
    settingsHint: document.querySelector('.settings-hint'),
    previewEmpty: document.getElementById('previewEmpty'),
    previewSubtitle: document.getElementById('previewSubtitle'),
    pagesStack: document.getElementById('pagesStack'),
    toast: document.getElementById('toast'),
  };

  let toastTimer = null;

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('visible');
    }, 2800);
  }

  function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
  }

  function sanitizePdfFilename(raw) {
    const clean = (raw || '')
      .trim()
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim();
    return `${clean || 'QR-Impresion'}.pdf`;
  }

  function clampNumber(val, min, max, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * Single source of truth for page layout geometry (in PDF points, origin bottom-left).
   * Shared by both the live WYSIWYG preview and the PDF generator.
   */
  function computeLayout(settings) {
    const page = PAGE_SIZES[settings.pageSize] || PAGE_SIZES.letter;
    const pageW = page.width;
    const pageH = page.height;

    const marginX = settings.marginXMm * MM_TO_PT;
    const marginTop = settings.marginTopMm * MM_TO_PT;
    const colGap = settings.colGapMm * MM_TO_PT;
    const rowGap = settings.rowGapMm * MM_TO_PT;

    const usableW = Math.max(100, pageW - 2 * marginX);
    const usableH = Math.max(100, pageH - 2 * marginTop);

    const maxCardW = (usableW - (CARDS_PER_PAGE - 1) * colGap) / CARDS_PER_PAGE;
    const maxCardH = (usableH - rowGap) / 2;
    const cardSize = Math.max(20, Math.min(maxCardW, maxCardH));

    const totalGridW = CARDS_PER_PAGE * cardSize + (CARDS_PER_PAGE - 1) * colGap;
    const totalGridH = 2 * cardSize + rowGap;

    const startX = (pageW - totalGridW) / 2;

    let topRowBottomY;
    let bottomRowBottomY;

    if (settings.verticalAlign === 'center') {
      bottomRowBottomY = (pageH - totalGridH) / 2;
      topRowBottomY = bottomRowBottomY + cardSize + rowGap;
    } else {
      topRowBottomY = pageH - marginTop - cardSize;
      bottomRowBottomY = topRowBottomY - rowGap - cardSize;
    }

    const colXs = [];
    for (let c = 0; c < CARDS_PER_PAGE; c++) {
      colXs.push(startX + c * (cardSize + colGap));
    }

    return {
      pageW,
      pageH,
      cardSize,
      colGap,
      rowGap,
      startX,
      totalGridW,
      totalGridH,
      topRowBottomY,
      bottomRowBottomY,
      foldLineY: bottomRowBottomY + cardSize + rowGap / 2,
      colXs,
      cardSizeCm: (cardSize / MM_TO_PT) / 10,
    };
  }

  function isDefaultSettings() {
    return (
      state.settings.pageSize === DEFAULT_SETTINGS.pageSize &&
      state.settings.verticalAlign === DEFAULT_SETTINGS.verticalAlign &&
      Math.abs(state.settings.colGapMm - DEFAULT_SETTINGS.colGapMm) < 0.01 &&
      Math.abs(state.settings.rowGapMm - DEFAULT_SETTINGS.rowGapMm) < 0.01 &&
      state.settings.showGuides === DEFAULT_SETTINGS.showGuides
    );
  }

  function chunkItems(items, size) {
    const pages = [];
    for (let i = 0; i < items.length; i += size) {
      pages.push(items.slice(i, i + size));
    }
    return pages;
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => {
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
    });

    if (files.length === 0) {
      showToast('Selecciona archivos de imagen válidos (PNG, JPG o WebP).');
      return;
    }

    for (const file of files) {
      const id = state.nextId++;
      const objectUrl = URL.createObjectURL(file);
      state.items.push({
        id,
        sourceId: `src-${id}`,
        name: file.name,
        displayName: stripExtension(file.name),
        file,
        objectUrl,
      });
    }

    renderAll();
    const plural = files.length === 1 ? 'imagen agregada' : 'imágenes agregadas';
    showToast(`${files.length} ${plural}.`);
  }

  function maybeRevokeUrl(sourceId, objectUrl) {
    const stillUsed = state.items.some((item) => item.sourceId === sourceId);
    if (!stillUsed && objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function removeItem(index) {
    const [removed] = state.items.splice(index, 1);
    if (removed) {
      maybeRevokeUrl(removed.sourceId, removed.objectUrl);
    }
    renderAll();
  }

  function duplicateItem(index) {
    const orig = state.items[index];
    if (!orig) return;
    const copy = {
      ...orig,
      id: state.nextId++,
    };
    state.items.splice(index + 1, 0, copy);
    renderAll();
    showToast(`"${orig.displayName}" duplicada.`);
  }

  function moveItem(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= state.items.length || fromIndex === toIndex) return;
    const [moved] = state.items.splice(fromIndex, 1);
    state.items.splice(toIndex, 0, moved);
    renderAll();
  }

  function sortItemsAZ() {
    state.items.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'es', { numeric: true, sensitivity: 'base' })
    );
    renderAll();
    showToast('Imágenes ordenadas alfabéticamente.');
  }

  function clearAll() {
    const seen = new Set();
    for (const item of state.items) {
      if (!seen.has(item.sourceId)) {
        seen.add(item.sourceId);
        URL.revokeObjectURL(item.objectUrl);
      }
    }
    state.items = [];
    renderAll();
    showToast('Lista limpiada.');
  }

  // Rendering
  function renderHeaderAndControls() {
    const count = state.items.length;
    const pageCount = Math.ceil(count / CARDS_PER_PAGE);

    const imgLabel = count === 1 ? 'imagen' : 'imágenes';
    const pageLabel = pageCount === 1 ? 'hoja' : 'hojas';
    el.summaryPill.textContent = `${count} ${imgLabel} · ${pageCount} ${pageLabel}`;
    el.countBadge.textContent = String(count);

    const hasItems = count > 0;
    el.btnGenerate.disabled = !hasItems || state.busy;
    el.btnPrint.disabled = !hasItems || state.busy;
    el.btnClearAll.disabled = !hasItems || state.busy;
    el.btnSortAZ.disabled = count < 2 || state.busy;

    el.queueEmpty.style.display = hasItems ? 'none' : 'block';
    el.queueList.style.display = hasItems ? 'flex' : 'none';

    el.settingsHint.textContent = isDefaultSettings() ? 'Formato original activo' : 'Personalizado';
  }

  function renderQueue() {
    el.queueList.innerHTML = '';

    state.items.forEach((item, index) => {
      const pageNum = Math.floor(index / CARDS_PER_PAGE) + 1;
      const colNum = (index % CARDS_PER_PAGE) + 1;

      const li = document.createElement('li');
      li.className = 'queue-item';
      li.draggable = true;
      li.dataset.index = String(index);

      li.innerHTML = `
        <span class="queue-index">${index + 1}</span>
        <img class="queue-thumb" src="${item.objectUrl}" alt="" loading="lazy" />
        <div class="queue-meta">
          <div class="queue-name"></div>
          <div class="queue-page-tag">Hoja ${pageNum} · Columna ${colNum}</div>
        </div>
        <div class="queue-actions">
          <button type="button" class="item-btn" data-action="up" title="Subir" ${index === 0 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button type="button" class="item-btn" data-action="down" title="Bajar" ${index === state.items.length - 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button type="button" class="item-btn" data-action="dup" title="Duplicar tarjeta">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button type="button" class="item-btn delete" data-action="del" title="Quitar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;

      li.querySelector('.queue-name').textContent = item.displayName;
      li.querySelector('.queue-name').title = item.name;

      // Button actions
      li.querySelector('[data-action="up"]').addEventListener('click', () => moveItem(index, index - 1));
      li.querySelector('[data-action="down"]').addEventListener('click', () => moveItem(index, index + 1));
      li.querySelector('[data-action="dup"]').addEventListener('click', () => duplicateItem(index));
      li.querySelector('[data-action="del"]').addEventListener('click', () => removeItem(index));

      // Drag-to-reorder
      li.addEventListener('dragstart', (e) => {
        state.dragIndex = index;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      });

      li.addEventListener('dragend', () => {
        state.dragIndex = null;
        li.classList.remove('dragging');
        el.queueList.querySelectorAll('.drag-target').forEach((n) => n.classList.remove('drag-target'));
      });

      li.addEventListener('dragover', (e) => {
        if (state.dragIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('drag-target');
      });

      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-target');
      });

      li.addEventListener('drop', (e) => {
        if (state.dragIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove('drag-target');
        const from = state.dragIndex;
        state.dragIndex = null;
        if (from !== index) {
          moveItem(from, index);
        }
      });

      el.queueList.appendChild(li);
    });
  }

  function renderPreview() {
    const pages = chunkItems(state.items, CARDS_PER_PAGE);
    const layout = computeLayout(state.settings);
    const pageMeta = PAGE_SIZES[state.settings.pageSize] || PAGE_SIZES.letter;

    el.previewSubtitle.textContent =
      `${pageMeta.label} · Tarjetas de ${layout.cardSizeCm.toFixed(1)} × ${layout.cardSizeCm.toFixed(1)} cm · Fila superior rotada 180°`;

    if (pages.length === 0) {
      el.previewEmpty.style.display = 'flex';
      el.pagesStack.innerHTML = '';
      return;
    }

    el.previewEmpty.style.display = 'none';
    el.pagesStack.innerHTML = '';

    const wPct = (layout.cardSize / layout.pageW) * 100;
    const hPct = (layout.cardSize / layout.pageH) * 100;
    const topRowTopPct = ((layout.pageH - (layout.topRowBottomY + layout.cardSize)) / layout.pageH) * 100;
    const bottomRowTopPct = ((layout.pageH - (layout.bottomRowBottomY + layout.cardSize)) / layout.pageH) * 100;

    pages.forEach((pageItems, pageIndex) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'sheet-wrapper';

      const namesSummary = pageItems.map((it) => it.displayName).join(', ');
      const caption = document.createElement('div');
      caption.className = 'sheet-caption';
      const leftSpan = document.createElement('span');
      leftSpan.innerHTML = `<strong>Hoja ${pageIndex + 1} de ${pages.length}</strong>`;
      const rightSpan = document.createElement('span');
      rightSpan.textContent = `${pageItems.length} ${pageItems.length === 1 ? 'tarjeta' : 'tarjetas'}: ${namesSummary}`;
      caption.appendChild(leftSpan);
      caption.appendChild(rightSpan);

      const sheet = document.createElement('div');
      sheet.className = 'sheet-canvas';
      sheet.style.aspectRatio = `${layout.pageW} / ${layout.pageH}`;

      pageItems.forEach((item, colIndex) => {
        const leftPct = (layout.colXs[colIndex] / layout.pageW) * 100;

        // Top row (180° rotated)
        const topSlot = document.createElement('div');
        topSlot.className = 'sheet-slot rotated';
        topSlot.style.left = `${leftPct}%`;
        topSlot.style.top = `${topRowTopPct}%`;
        topSlot.style.width = `${wPct}%`;
        topSlot.style.height = `${hPct}%`;
        const topImg = document.createElement('img');
        topImg.src = item.objectUrl;
        topImg.alt = `${item.displayName} (superior 180°)`;
        topSlot.appendChild(topImg);
        sheet.appendChild(topSlot);

        // Bottom row (normal 0°)
        const botSlot = document.createElement('div');
        botSlot.className = 'sheet-slot';
        botSlot.style.left = `${leftPct}%`;
        botSlot.style.top = `${bottomRowTopPct}%`;
        botSlot.style.width = `${wPct}%`;
        botSlot.style.height = `${hPct}%`;
        const botImg = document.createElement('img');
        botImg.src = item.objectUrl;
        botImg.alt = item.displayName;
        botSlot.appendChild(botImg);
        sheet.appendChild(botSlot);
      });

      // Optional cut & fold preview guides
      if (state.settings.showGuides && pageItems.length > 0) {
        const activeCount = pageItems.length;
        const activeWidth = activeCount * layout.cardSize + (activeCount - 1) * layout.colGap;
        const foldTopPct = ((layout.pageH - layout.foldLineY) / layout.pageH) * 100;

        const foldLine = document.createElement('div');
        foldLine.className = 'sheet-guide-fold';
        foldLine.style.left = `${(layout.startX / layout.pageW) * 100}%`;
        foldLine.style.width = `${(activeWidth / layout.pageW) * 100}%`;
        foldLine.style.top = `${foldTopPct}%`;
        sheet.appendChild(foldLine);

        const guideTopPct = Math.max(0, ((layout.pageH - (layout.topRowBottomY + layout.cardSize + 8)) / layout.pageH) * 100);
        const guideHeightPct = ((layout.totalGridH + 16) / layout.pageH) * 100;

        for (let c = 0; c < activeCount - 1; c++) {
          const cutX = layout.colXs[c] + layout.cardSize + layout.colGap / 2;
          const cutLine = document.createElement('div');
          cutLine.className = 'sheet-guide-cut';
          cutLine.style.left = `${(cutX / layout.pageW) * 100}%`;
          cutLine.style.top = `${guideTopPct}%`;
          cutLine.style.height = `${guideHeightPct}%`;
          sheet.appendChild(cutLine);
        }
      }

      wrapper.appendChild(caption);
      wrapper.appendChild(sheet);
      el.pagesStack.appendChild(wrapper);
    });
  }

  function renderAll() {
    renderHeaderAndControls();
    renderQueue();
    renderPreview();
  }

  // Image -> PDF Embedding Helpers
  function detectImageFormat(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'jpg';
    }
    return 'other';
  }

  function convertFileToPngBytes(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error(`No se pudo convertir la imagen ${file.name}`));
              return;
            }
            blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
          }, 'image/png');
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`No se pudo leer la imagen ${file.name}`));
      };
      img.src = url;
    });
  }

  async function embedImageFile(pdfDoc, file) {
    const rawBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(rawBuffer);
    const fmt = detectImageFormat(bytes);

    if (fmt === 'png') {
      try {
        return await pdfDoc.embedPng(bytes);
      } catch (_) {
        // Fallback through canvas if PNG uses an unsupported color format
      }
    } else if (fmt === 'jpg') {
      try {
        return await pdfDoc.embedJpg(bytes);
      } catch (_) {
        // Fallback through canvas if JPEG uses CMYK or unusual encoding
      }
    }

    const pngBytes = await convertFileToPngBytes(file);
    return await pdfDoc.embedPng(pngBytes);
  }

  function drawFittedImage(page, pdfImg, boxX, boxY, boxSize, rotate180) {
    const imgRatio = pdfImg.width / pdfImg.height;
    let drawW = boxSize;
    let drawH = boxSize;
    let offsetX = 0;
    let offsetY = 0;

    if (Math.abs(imgRatio - 1) > 0.005) {
      if (imgRatio > 1) {
        drawH = boxSize / imgRatio;
        offsetY = (boxSize - drawH) / 2;
      } else {
        drawW = boxSize * imgRatio;
        offsetX = (boxSize - drawW) / 2;
      }
    }

    if (rotate180) {
      // In PDF coordinates, rotating 180° around (x, y) draws into [x - w, x] × [y - h, y]
      page.drawImage(pdfImg, {
        x: boxX + offsetX + drawW,
        y: boxY + offsetY + drawH,
        width: drawW,
        height: drawH,
        rotate: window.PDFLib.degrees(180),
      });
    } else {
      page.drawImage(pdfImg, {
        x: boxX + offsetX,
        y: boxY + offsetY,
        width: drawW,
        height: drawH,
      });
    }
  }

  async function buildPdfBytes() {
    if (!window.PDFLib) {
      throw new Error('No se cargó la librería local pdf-lib. Verifica la carpeta lib/.');
    }

    const { PDFDocument, rgb } = window.PDFLib;
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(sanitizePdfFilename(el.outputName.value));
    pdfDoc.setCreator('Impresión QR');

    const layout = computeLayout(state.settings);
    const pages = chunkItems(state.items, CARDS_PER_PAGE);

    // Embed each unique source image once so the PDF stays compact and crisp
    const embeddedCache = new Map();
    for (const item of state.items) {
      if (!embeddedCache.has(item.sourceId)) {
        const embedded = await embedImageFile(pdfDoc, item.file);
        embeddedCache.set(item.sourceId, embedded);
      }
    }

    const guideColor = rgb(0.68, 0.72, 0.7);

    for (const pageItems of pages) {
      const page = pdfDoc.addPage([layout.pageW, layout.pageH]);

      pageItems.forEach((item, colIndex) => {
        const pdfImg = embeddedCache.get(item.sourceId);
        const colX = layout.colXs[colIndex];

        // Top row: rotated 180°
        drawFittedImage(page, pdfImg, colX, layout.topRowBottomY, layout.cardSize, true);

        // Bottom row: upright 0°
        drawFittedImage(page, pdfImg, colX, layout.bottomRowBottomY, layout.cardSize, false);
      });

      if (state.settings.showGuides && pageItems.length > 0) {
        const activeCount = pageItems.length;
        const activeRightX = layout.startX + activeCount * layout.cardSize + (activeCount - 1) * layout.colGap;

        // Horizontal fold guide
        page.drawLine({
          start: { x: layout.startX, y: layout.foldLineY },
          end: { x: activeRightX, y: layout.foldLineY },
          thickness: 0.5,
          color: guideColor,
          dashArray: [4, 4],
        });

        // Vertical cut guides between cards
        const cutBottomY = Math.max(8, layout.bottomRowBottomY - 8);
        const cutTopY = Math.min(layout.pageH - 8, layout.topRowBottomY + layout.cardSize + 8);
        for (let c = 0; c < activeCount - 1; c++) {
          const cutX = layout.colXs[c] + layout.cardSize + layout.colGap / 2;
          page.drawLine({
            start: { x: cutX, y: cutBottomY },
            end: { x: cutX, y: cutTopY },
            thickness: 0.5,
            color: guideColor,
            dashArray: [3, 4],
          });
        }
      }
    }

    return await pdfDoc.save();
  }

  async function handleExport(mode) {
    if (state.items.length === 0 || state.busy) return;

    state.busy = true;
    el.btnGenerateLabel.textContent = 'Generando...';
    renderHeaderAndControls();

    try {
      const pdfBytes = await buildPdfBytes();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const filename = sanitizePdfFilename(el.outputName.value);

      if (mode === 'print') {
        const win = window.open(blobUrl, '_blank');
        if (!win) {
          // Fallback to download if popup was blocked
          triggerDownload(blobUrl, filename);
          showToast('Ventana bloqueada: se descargó el PDF directamente.');
        } else {
          showToast('PDF abierto en nueva pestaña.');
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } else {
        triggerDownload(blobUrl, filename);
        showToast(`PDF descargado: ${filename}`);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      }
    } catch (err) {
      console.error(err);
      showToast(`Error al generar el PDF: ${err.message || err}`);
    } finally {
      state.busy = false;
      el.btnGenerateLabel.textContent = 'Descargar PDF';
      renderHeaderAndControls();
    }
  }

  function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Event Wiring
  function bindEvents() {
    el.btnSelectFiles.addEventListener('click', (e) => {
      e.stopPropagation();
      el.fileInput.click();
    });

    el.dropzone.addEventListener('click', () => {
      el.fileInput.click();
    });

    el.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.fileInput.click();
      }
    });

    el.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = '';
      }
    });

    // Dropzone drag & drop
    ['dragenter', 'dragover'].forEach((evt) => {
      el.dropzone.addEventListener(evt, (e) => {
        if (state.dragIndex !== null) return;
        e.preventDefault();
        e.stopPropagation();
        el.dropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((evt) => {
      el.dropzone.addEventListener(evt, (e) => {
        if (state.dragIndex !== null) return;
        e.preventDefault();
        e.stopPropagation();
        el.dropzone.classList.remove('drag-over');
      });
    });

    el.dropzone.addEventListener('drop', (e) => {
      if (state.dragIndex !== null) return;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    });

    // Allow dropping files anywhere on the page
    window.addEventListener('dragover', (e) => {
      if (state.dragIndex === null) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      if (state.dragIndex !== null) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    });

    // Queue actions
    el.btnSortAZ.addEventListener('click', sortItemsAZ);
    el.btnClearAll.addEventListener('click', clearAll);

    // Export actions
    el.btnGenerate.addEventListener('click', () => handleExport('download'));
    el.btnPrint.addEventListener('click', () => handleExport('print'));

    // Settings
    el.pageSize.addEventListener('change', () => {
      state.settings.pageSize = el.pageSize.value;
      renderAll();
    });

    el.verticalAlign.addEventListener('change', () => {
      state.settings.verticalAlign = el.verticalAlign.value;
      renderAll();
    });

    el.colGapMm.addEventListener('input', () => {
      state.settings.colGapMm = clampNumber(el.colGapMm.value, 0, 15, DEFAULT_SETTINGS.colGapMm);
      renderAll();
    });

    el.rowGapMm.addEventListener('input', () => {
      state.settings.rowGapMm = clampNumber(el.rowGapMm.value, 0, 20, DEFAULT_SETTINGS.rowGapMm);
      renderAll();
    });

    el.showGuides.addEventListener('change', () => {
      state.settings.showGuides = el.showGuides.checked;
      renderAll();
    });

    el.btnResetSettings.addEventListener('click', () => {
      state.settings = { ...DEFAULT_SETTINGS };
      el.pageSize.value = DEFAULT_SETTINGS.pageSize;
      el.verticalAlign.value = DEFAULT_SETTINGS.verticalAlign;
      el.colGapMm.value = String(DEFAULT_SETTINGS.colGapMm);
      el.rowGapMm.value = String(DEFAULT_SETTINGS.rowGapMm);
      el.showGuides.checked = DEFAULT_SETTINGS.showGuides;
      renderAll();
      showToast('Formato original restaurado.');
    });
  }

  bindEvents();
  renderAll();
})();
