(function (root) {
  "use strict";

  function assetUrl(src) {
    return root.EXPORT_ASSETS?.[src] || src;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load export image: ${src}`));
      image.src = assetUrl(src);
    });
  }

  function teamColor(team) {
    if (team === "blue") return "rgba(54, 163, 255, 0.22)";
    if (team === "red") return "rgba(239, 75, 92, 0.22)";
    return "rgba(214, 172, 85, 0.22)";
  }

  // Capture everything before loading images, so later edits cannot change this export.
  function createSnapshot(options) {
    const copiedState = JSON.parse(JSON.stringify(options.state));
    const copiedFilters = { ...options.filters };
    return {
      items: copiedState.items
        .filter((item) => options.isItemVisible(item, copiedFilters))
        .map((item) => ({ ...item, asset: options.assetFor(item) })),
      paths: copiedFilters.drawings ? copiedState.paths : [],
      diagramWidth: options.diagramWidth,
      showSight: options.showSight,
      showRanges: options.showRanges,
      showLabels: options.showLabels,
      fontFamily: options.fontFamily || "system-ui, sans-serif",
      filename: options.filename
    };
  }

  function fitLabel(context, label, maxWidth) {
    if (context.measureText(label).width <= maxWidth) return label;
    const characters = Array.from(label);
    let start = 0;
    let end = characters.length;
    while (start < end) {
      const middle = Math.ceil((start + end) / 2);
      const candidate = `${characters.slice(0, middle).join("")}…`;
      if (context.measureText(candidate).width <= maxWidth) start = middle;
      else end = middle - 1;
    }
    return `${characters.slice(0, start).join("")}…`;
  }

  async function renderToCanvas(snapshot, options = {}) {
    const size = options.size || 1600;
    const canvas = options.createCanvas ? options.createCanvas() : root.document.createElement("canvas");
    const getImage = options.loadImage || loadImage;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A 2D canvas is required for PNG export.");
    if (!(snapshot.diagramWidth > 0)) throw new Error("The diagram must have a visible width to export.");

    // Tokens and labels use CSS pixels in the editor; path strokes use SVG viewBox units.
    const cssScale = size / snapshot.diagramWidth;
    const svgScale = size / 1000;
    const mapImage = await getImage("assets/sr-export.jpg");
    context.drawImage(mapImage, 0, 0, size, size);

    if (snapshot.showSight) {
      const sightImage = await getImage("assets/sr sight.jpeg");
      context.globalAlpha = 0.88;
      context.drawImage(sightImage, 0, 0, size, size);
      context.globalAlpha = 1;
    }

    for (const path of snapshot.paths) {
      if (!path.points?.length) continue;
      context.beginPath();
      path.points.forEach((point, index) => {
        const x = (point.x / 100) * size;
        const y = (point.y / 100) * size;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = path.color || "#f0d66a";
      context.lineWidth = (path.width || 7) * svgScale;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    }

    for (const item of snapshot.items) {
      const image = await getImage(item.asset);
      const cssIconSize = Math.max(item.size * 4, 6);
      const iconSize = cssIconSize * cssScale;
      const hitSize = Math.max(cssIconSize + 8, 16) * cssScale;
      const centerX = (item.x / 100) * size;
      const centerY = (item.y / 100) * size;
      const x = centerX - iconSize / 2;
      const y = centerY - iconSize / 2;
      context.globalAlpha = (item.opacity / 100) * (item.cloaked ? 0.4 : 1);

      if (item.range > 0 && snapshot.showRanges) {
        context.beginPath();
        context.lineWidth = 2 * cssScale;
        // CSS uses border-box sizing, so the stroke stays inside the range diameter.
        const radius = Math.max(0, item.range / 2 - 1) * cssScale;
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.strokeStyle = teamColor(item.team);
        context.stroke();
      }

      context.drawImage(image, x, y, iconSize, iconSize);

      if (snapshot.showLabels) {
        context.font = `700 ${12 * cssScale}px ${snapshot.fontFamily}`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.lineWidth = 2 * cssScale;
        context.strokeStyle = "rgba(0,0,0,.75)";
        context.fillStyle = "#f3f6f2";
        const labelY = centerY + hitSize / 2 + 5 * cssScale;
        const label = fitLabel(context, item.label, 110 * cssScale);
        context.strokeText(label, centerX, labelY);
        context.fillText(label, centerX, labelY);
      }
      context.globalAlpha = 1;
    }

    return canvas;
  }

  async function createPng(snapshot, options) {
    const canvas = await renderToCanvas(snapshot, options);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas did not produce a PNG blob."));
      }, "image/png");
    });
  }

  const api = { assetUrl, createSnapshot, renderToCanvas, createPng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DiagramExport = api;
})(typeof window !== "undefined" ? window : globalThis);
