'use strict';

/* ================================================================
   BEAST TAG GENERATOR — script.js
   ----------------------------------------------------------------
   Everything here is computed, not hardcoded. Given two colors,
   the tag is rebuilt pixel-by-pixel:

     1. ColorMath        — generic color-math helpers (hex<->rgb,
                            lerp, HSL adjustments, matching, etc).
     2. ColorEngine       — the actual BEAST-tag recoloring formulas
                            (gradient background, tinted letters,
                            derived shadow). Tweak this to restyle
                            the tag without touching anything else.
     3. BeastTagTemplate  — builds the 40x8 pixel layout. Uses a
                            built-in "BEAST" pixel font by default,
                            or loads beasttagbase.png if present.
     4. BeastTagRenderer  — combines a template + two colors into
                            raw ImageData.
     5. BeastTagApp       — DOM wiring: inputs, canvas scaling,
                            PNG export, and the live UI accent.
   ================================================================ */

/* ------------------------------------------------------------
   1. CONSTANTS
   ------------------------------------------------------------ */

const TAG_WIDTH = 40;
const TAG_HEIGHT = 8;

// The three colors used inside beasttagbase.png (and the built-in
// fallback template). Any other opaque color found in a loaded PNG
// is treated as "raw" and copied through unchanged.
const TEMPLATE_COLORS = {
  BACKGROUND: '#008FFF',
  LETTER: '#FFFFFF',
  SHADOW: '#636363',
};

// Categories stored in the internal 40x8 template grid.
const CELL = {
  BACKGROUND: 0,
  LETTER: 1,
  SHADOW: 2,
  RAW: 3, // pixel copied through unchanged (e.g. transparent margin)
};

// --- Recoloring "dials". Change these to restyle the tag. ---

// How strongly the gradient colors tint the (mostly white) letters.
// 0 = pure white, 1 = full gradient color.
const TEXT_TINT_STRENGTH = 0.16;

// How much darker / less saturated the shadow is versus the letter
// color sitting above it.
const SHADOW_DESATURATE = 0.35;
const SHADOW_DARKEN = 0.30;

// Subtle lighting across the whole tag: a lightness gain at the top
// row fading to a lightness loss at the bottom row, plus extra
// darkening on the leftmost/rightmost columns.
const VERTICAL_HIGHLIGHT = 0.10;
const VERTICAL_SHADOW = 0.12;
const EDGE_DARKEN = 0.08;

// Preview scaling limits (integer multiples keep pixels crisp).
const MIN_PREVIEW_SCALE = 4;
const MAX_PREVIEW_SCALE = 24;

/* ------------------------------------------------------------
   2. COLOR MATH
   Generic, reusable color helpers. Nothing BEAST-specific lives
   here on purpose, so this class could be lifted into any other
   project unchanged.
   ------------------------------------------------------------ */
class ColorMath {
  /** Parses '#RRGGBB' or '#RGB' (with or without '#') into {r,g,b}. */
  static hexToRgb(hex) {
    let clean = String(hex).trim().replace(/^#/, '');
    if (clean.length === 3) {
      clean = clean.split('').map((ch) => ch + ch).join('');
    }
    const value = parseInt(clean, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }

  /** Converts {r,g,b} (0-255 each) into '#RRGGBB'. */
  static rgbToHex({ r, g, b }) {
    const toHex = (n) => ColorMath.clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  static clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  static lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Linearly blends two RGB colors channel-by-channel. t=0 -> rgb1, t=1 -> rgb2. */
  static mixColors(rgb1, rgb2, t) {
    return {
      r: ColorMath.lerp(rgb1.r, rgb2.r, t),
      g: ColorMath.lerp(rgb1.g, rgb2.g, t),
      b: ColorMath.lerp(rgb1.b, rgb2.b, t),
    };
  }

  /** Midpoint of two colors — shorthand for mixColors(a, b, 0.5). */
  static averageColor(rgb1, rgb2) {
    return ColorMath.mixColors(rgb1, rgb2, 0.5);
  }

  static rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rn:
          h = (gn - bn) / d + (gn < bn ? 6 : 0);
          break;
        case gn:
          h = (bn - rn) / d + 2;
          break;
        default:
          h = (rn - gn) / d + 4;
          break;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  static hslToRgb({ h, s, l }) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }

    const hue2rgb = (p, q, tIn) => {
      let t = tIn;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
  }

  /** Shifts lightness by `delta` (-1..1) in HSL space. Positive = lighter. */
  static adjustLightness(rgb, delta) {
    const hsl = ColorMath.rgbToHsl(rgb);
    hsl.l = ColorMath.clamp(hsl.l + delta, 0, 1);
    return ColorMath.hslToRgb(hsl);
  }

  /** Shifts saturation by `delta` (-1..1) in HSL space. Positive = more vivid. */
  static adjustSaturation(rgb, delta) {
    const hsl = ColorMath.rgbToHsl(rgb);
    hsl.s = ColorMath.clamp(hsl.s + delta, 0, 1);
    return ColorMath.hslToRgb(hsl);
  }

  static lighten(rgb, amount) { return ColorMath.adjustLightness(rgb, amount); }
  static darken(rgb, amount) { return ColorMath.adjustLightness(rgb, -amount); }
  static saturate(rgb, amount) { return ColorMath.adjustSaturation(rgb, amount); }
  static desaturate(rgb, amount) { return ColorMath.adjustSaturation(rgb, -amount); }

  /** True if two RGB colors are within `tolerance` per channel. */
  static colorsMatch(rgb1, rgb2, tolerance = 6) {
    return (
      Math.abs(rgb1.r - rgb2.r) <= tolerance &&
      Math.abs(rgb1.g - rgb2.g) <= tolerance &&
      Math.abs(rgb1.b - rgb2.b) <= tolerance
    );
  }

  /** Random opaque color as '#RRGGBB'. */
  static randomHex() {
    const channel = () => Math.floor(Math.random() * 256);
    return ColorMath.rgbToHex({ r: channel(), g: channel(), b: channel() });
  }
}

/* ------------------------------------------------------------
   3. COLOR ENGINE
   The actual BEAST-tag recoloring formulas. This is the piece to
   edit if you want the tag to look different — everything else
   just plumbs these results into pixels.
   ------------------------------------------------------------ */
class ColorEngine {
  /** Smooth left-to-right gradient color at pixel column x (0..TAG_WIDTH-1). */
  static gradientColorAt(x, colorStart, colorEnd) {
    const t = x / (TAG_WIDTH - 1);
    return ColorMath.mixColors(colorStart, colorEnd, t);
  }

  /**
   * Background pixel color: the base gradient, plus a top highlight
   * fading to a bottom shadow, plus extra darkening on the far
   * left/right edge columns.
   */
  static backgroundColorAt(x, y, colorStart, colorEnd) {
    const base = ColorEngine.gradientColorAt(x, colorStart, colorEnd);

    const rowT = y / (TAG_HEIGHT - 1);
    const rowDelta = ColorMath.lerp(VERTICAL_HIGHLIGHT, -VERTICAL_SHADOW, rowT);
    let shaded = ColorMath.adjustLightness(base, rowDelta);

    const isEdgeColumn = x === 0 || x === TAG_WIDTH - 1;
    if (isEdgeColumn) {
      shaded = ColorMath.adjustLightness(shaded, -EDGE_DARKEN);
    }

    return shaded;
  }

  /**
   * Letter pixel color: stays mostly white, but is pulled slightly
   * toward whichever gradient color sits under that column — so
   * letters on the left lean toward Color 1 and letters on the
   * right lean toward Color 2.
   */
  static textColorAt(x, colorStart, colorEnd) {
    const white = { r: 255, g: 255, b: 255 };
    const localGradient = ColorEngine.gradientColorAt(x, colorStart, colorEnd);
    return ColorMath.mixColors(white, localGradient, TEXT_TINT_STRENGTH);
  }

  /**
   * Shadow pixel color: derived from the letter color at the same
   * column — darker and less saturated, never a fixed gray.
   */
  static shadowColorAt(x, colorStart, colorEnd) {
    const letterColor = ColorEngine.textColorAt(x, colorStart, colorEnd);
    const desaturated = ColorMath.desaturate(letterColor, SHADOW_DESATURATE);
    return ColorMath.darken(desaturated, SHADOW_DARKEN);
  }
}

/* ------------------------------------------------------------
   4. TEMPLATE
   Builds the 40x8 layout grid: which pixels are background,
   letter, shadow, or "raw" (left untouched). Ships with a
   built-in pixel-font rendering of "BEAST" so the site works with
   zero setup, but will happily load a real beasttagbase.png and
   classify its pixels instead if that file is present.
   ------------------------------------------------------------ */
class BeastTagTemplate {
  constructor() {
    this.grid = new Uint8Array(TAG_WIDTH * TAG_HEIGHT).fill(CELL.BACKGROUND);
    this.rawColors = new Map(); // index -> {r,g,b,a}, only used for CELL.RAW
    this.isCustom = false;
    this._buildDefaultGrid();
  }

  index(x, y) {
    return y * TAG_WIDTH + x;
  }

  getCell(x, y) {
    return this.grid[this.index(x, y)];
  }

  _setCell(x, y, value) {
    if (x < 0 || x >= TAG_WIDTH || y < 0 || y >= TAG_HEIGHT) return;
    this.grid[this.index(x, y)] = value;
  }

  _isLetterCell(x, y) {
    if (x < 0 || x >= TAG_WIDTH || y < 0 || y >= TAG_HEIGHT) return false;
    return this.grid[this.index(x, y)] === CELL.LETTER;
  }

  /**
   * Draws a simple 3x5 pixel font spelling "BEAST" across the
   * 40x8 grid, then stamps a one-pixel drop shadow (down + right)
   * on every letter pixel that doesn't already touch another
   * letter pixel.
   */
  _buildDefaultGrid() {
    const WORD = 'BEAST';
    const CELL_WIDTH = TAG_WIDTH / WORD.length; // 8px per letter
    const GLYPH_OFFSET_X = 1; // left margin inside each letter cell
    const GLYPH_OFFSET_Y = 1; // top margin inside the 8px-tall tag

    // 3 columns x 5 rows each, '#' = ink, '.' = empty.
    const GLYPHS = {
      B: ['###', '#.#', '###', '#.#', '###'],
      E: ['###', '#..', '###', '#..', '###'],
      A: ['.#.', '#.#', '###', '#.#', '#.#'],
      S: ['###', '#..', '###', '..#', '###'],
      T: ['###', '.#.', '.#.', '.#.', '.#.'],
    };

    const letterPixels = [];

    for (let letterIndex = 0; letterIndex < WORD.length; letterIndex++) {
      const glyph = GLYPHS[WORD[letterIndex]];
      const baseX = letterIndex * CELL_WIDTH + GLYPH_OFFSET_X;

      for (let row = 0; row < glyph.length; row++) {
        for (let col = 0; col < glyph[row].length; col++) {
          if (glyph[row][col] === '#') {
            const x = baseX + col;
            const y = GLYPH_OFFSET_Y + row;
            this._setCell(x, y, CELL.LETTER);
            letterPixels.push([x, y]);
          }
        }
      }
    }

    // Drop shadow: one pixel down-right of every letter pixel,
    // unless that spot is itself part of a letter (letters win).
    for (const [x, y] of letterPixels) {
      const shadowX = x + 1;
      const shadowY = y + 1;
      if (!this._isLetterCell(shadowX, shadowY)) {
        this._setCell(shadowX, shadowY, CELL.SHADOW);
      }
    }
  }

  /**
   * Attempts to replace the built-in grid with one read from a real
   * beasttagbase.png (must be exactly 40x8px). Returns true on
   * success, false if the file is missing/unreadable/wrong size —
   * in which case the built-in grid is left untouched.
   */
  async loadFromImage(url) {
    try {
      const image = await BeastTagTemplate._loadImageElement(url);

      if (image.naturalWidth !== TAG_WIDTH || image.naturalHeight !== TAG_HEIGHT) {
        console.warn(
          `${url} should be ${TAG_WIDTH}x${TAG_HEIGHT}px (got ${image.naturalWidth}x${image.naturalHeight}). Using the built-in template instead.`
        );
        return false;
      }

      const offscreen = document.createElement('canvas');
      offscreen.width = TAG_WIDTH;
      offscreen.height = TAG_HEIGHT;
      const ctx = offscreen.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, TAG_WIDTH, TAG_HEIGHT);

      const newGrid = new Uint8Array(TAG_WIDTH * TAG_HEIGHT);
      const newRaw = new Map();

      const bgRgb = ColorMath.hexToRgb(TEMPLATE_COLORS.BACKGROUND);
      const letterRgb = ColorMath.hexToRgb(TEMPLATE_COLORS.LETTER);
      const shadowRgb = ColorMath.hexToRgb(TEMPLATE_COLORS.SHADOW);

      for (let i = 0; i < TAG_WIDTH * TAG_HEIGHT; i++) {
        const offset = i * 4;
        const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
        const alpha = data[offset + 3];

        if (alpha === 0) {
          newGrid[i] = CELL.RAW;
          newRaw.set(i, { r: 0, g: 0, b: 0, a: 0 });
        } else if (ColorMath.colorsMatch(pixel, bgRgb)) {
          newGrid[i] = CELL.BACKGROUND;
        } else if (ColorMath.colorsMatch(pixel, letterRgb)) {
          newGrid[i] = CELL.LETTER;
        } else if (ColorMath.colorsMatch(pixel, shadowRgb)) {
          newGrid[i] = CELL.SHADOW;
        } else {
          // Unrecognized opaque color: leave it exactly as-is.
          newGrid[i] = CELL.RAW;
          newRaw.set(i, { r: pixel.r, g: pixel.g, b: pixel.b, a: alpha });
        }
      }

      this.grid = newGrid;
      this.rawColors = newRaw;
      this.isCustom = true;
      return true;
    } catch (error) {
      console.info(
        `${url} not found (or unreadable) — using the built-in default "BEAST" template.`
      );
      return false;
    }
  }

  static _loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
  }
}

/* ------------------------------------------------------------
   5. RENDERER
   Combines a template grid with two colors to produce raw
   ImageData at true 40x8 size.
   ------------------------------------------------------------ */
class BeastTagRenderer {
  constructor(template) {
    this.template = template;
  }

  /** @returns {ImageData} 40x8 RGBA pixel data for the given hex colors. */
  render(color1Hex, color2Hex) {
    const colorStart = ColorMath.hexToRgb(color1Hex);
    const colorEnd = ColorMath.hexToRgb(color2Hex);
    const imageData = new ImageData(TAG_WIDTH, TAG_HEIGHT);

    for (let y = 0; y < TAG_HEIGHT; y++) {
      for (let x = 0; x < TAG_WIDTH; x++) {
        const cellIndex = this.template.index(x, y);
        const pixelOffset = cellIndex * 4;
        const cellType = this.template.grid[cellIndex];

        let rgb;
        let alpha = 255;

        switch (cellType) {
          case CELL.BACKGROUND:
            rgb = ColorEngine.backgroundColorAt(x, y, colorStart, colorEnd);
            break;
          case CELL.LETTER:
            rgb = ColorEngine.textColorAt(x, colorStart, colorEnd);
            break;
          case CELL.SHADOW:
            rgb = ColorEngine.shadowColorAt(x, colorStart, colorEnd);
            break;
          case CELL.RAW:
          default: {
            const raw = this.template.rawColors.get(cellIndex) || { r: 0, g: 0, b: 0, a: 0 };
            rgb = raw;
            alpha = raw.a;
            break;
          }
        }

        imageData.data[pixelOffset] = rgb.r;
        imageData.data[pixelOffset + 1] = rgb.g;
        imageData.data[pixelOffset + 2] = rgb.b;
        imageData.data[pixelOffset + 3] = alpha;
      }
    }

    return imageData;
  }
}

/* ------------------------------------------------------------
   6. APP
   DOM wiring: reads/writes the two color inputs, keeps a true
   40x8 "source" canvas (used for PNG export) in sync with an
   enlarged, nearest-neighbor-scaled preview canvas, and updates
   the page's live accent colors.
   ------------------------------------------------------------ */
class BeastTagApp {
  constructor() {
    this.elements = {
      color1Picker: document.getElementById('color1Picker'),
      color1Hex: document.getElementById('color1Hex'),
      color2Picker: document.getElementById('color2Picker'),
      color2Hex: document.getElementById('color2Hex'),
      swapBtn: document.getElementById('swapBtn'),
      randomBtn: document.getElementById('randomBtn'),
      downloadBtn: document.getElementById('downloadBtn'),
      gridToggle: document.getElementById('gridToggle'),
      previewWrapper: document.getElementById('previewWrapper'),
      previewCanvas: document.getElementById('previewCanvas'),
      statusText: document.getElementById('statusText'),
    };

    this.state = {
      color1: this.elements.color1Hex.value,
      color2: this.elements.color2Hex.value,
      showGrid: false,
    };

    // True 40x8 canvas — never displayed, used only as the source
    // of truth for both the scaled preview and the PNG export.
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = TAG_WIDTH;
    this.sourceCanvas.height = TAG_HEIGHT;
    this.sourceCtx = this.sourceCanvas.getContext('2d');

    this.template = new BeastTagTemplate();
    this.renderer = new BeastTagRenderer(this.template);

    this._bindEvents();
    this._observeResize();
    this._init();
  }

  async _init() {
    const loadedCustomTemplate = await this.template.loadFromImage('beasttagbase.png');
    this._setStatus(
      loadedCustomTemplate
        ? 'Loaded custom template from beasttagbase.png.'
        : 'Using the built-in default template (add beasttagbase.png to customize the layout).'
    );
    this.renderAll();
  }

  /* ---------------- Event wiring ---------------- */

  _bindEvents() {
    const { elements } = this;

    elements.color1Picker.addEventListener('input', () => {
      this._setColor(1, elements.color1Picker.value);
    });
    elements.color2Picker.addEventListener('input', () => {
      this._setColor(2, elements.color2Picker.value);
    });

    elements.color1Hex.addEventListener('input', () => {
      this._handleHexInput(1, elements.color1Hex);
    });
    elements.color2Hex.addEventListener('input', () => {
      this._handleHexInput(2, elements.color2Hex);
    });

    elements.swapBtn.addEventListener('click', () => {
      const { color1, color2 } = this.state;
      this._setColor(1, color2, { skipRender: true });
      this._setColor(2, color1);
    });

    elements.randomBtn.addEventListener('click', () => {
      this._setColor(1, ColorMath.randomHex(), { skipRender: true });
      this._setColor(2, ColorMath.randomHex());
    });

    elements.downloadBtn.addEventListener('click', () => this._downloadPng());

    elements.gridToggle.addEventListener('change', () => {
      this.state.showGrid = elements.gridToggle.checked;
      this._drawPreview();
    });
  }

  _observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => this._drawPreview());
    observer.observe(this.elements.previewWrapper);
  }

  /* ---------------- Color state helpers ---------------- */

  /**
   * Normalizes a hex string typed by the user. Returns '#RRGGBB'
   * (uppercase) or null if the input isn't a valid hex color yet.
   */
  static normalizeHex(value) {
    const trimmed = value.trim();
    const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(trimmed);
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) {
      hex = hex.split('').map((ch) => ch + ch).join('');
    }
    return `#${hex.toUpperCase()}`;
  }

  _handleHexInput(slot, inputEl) {
    const normalized = BeastTagApp.normalizeHex(inputEl.value);
    if (normalized) {
      inputEl.classList.remove('is-invalid');
      this._setColor(slot, normalized);
    } else {
      // Let the user keep typing without fighting them; just flag it.
      inputEl.classList.add('is-invalid');
    }
  }

  _setColor(slot, hexValue, { skipRender = false } = {}) {
    const normalized = BeastTagApp.normalizeHex(hexValue) || hexValue;
    const key = slot === 1 ? 'color1' : 'color2';
    const pickerEl = slot === 1 ? this.elements.color1Picker : this.elements.color2Picker;
    const hexEl = slot === 1 ? this.elements.color1Hex : this.elements.color2Hex;

    this.state[key] = normalized;
    pickerEl.value = normalized;
    hexEl.value = normalized;
    hexEl.classList.remove('is-invalid');

    if (!skipRender) {
      this.renderAll();
    }
  }

  /* ---------------- Rendering ---------------- */

  renderAll() {
    const imageData = this.renderer.render(this.state.color1, this.state.color2);
    this.sourceCtx.putImageData(imageData, 0, 0);
    this._drawPreview();
    this._updateLiveAccent();
  }

  _drawPreview() {
    const wrapper = this.elements.previewWrapper;
    const canvas = this.elements.previewCanvas;
    const wrapperWidth = wrapper.clientWidth || TAG_WIDTH * MIN_PREVIEW_SCALE;

    // Integer scale keeps every source pixel mapped to a whole
    // number of screen pixels, so upscaling stays perfectly crisp.
    const scale = ColorMath.clamp(
      Math.floor(wrapperWidth / TAG_WIDTH),
      MIN_PREVIEW_SCALE,
      MAX_PREVIEW_SCALE
    );

    canvas.width = TAG_WIDTH * scale;
    canvas.height = TAG_HEIGHT * scale;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      this.sourceCanvas,
      0, 0, TAG_WIDTH, TAG_HEIGHT,
      0, 0, canvas.width, canvas.height
    );

    if (this.state.showGrid && scale >= 6) {
      this._drawPixelGrid(ctx, scale);
    }
  }

  _drawPixelGrid(ctx, scale) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;

    for (let x = 1; x < TAG_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * scale + 0.5, 0);
      ctx.lineTo(x * scale + 0.5, TAG_HEIGHT * scale);
      ctx.stroke();
    }
    for (let y = 1; y < TAG_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale + 0.5);
      ctx.lineTo(TAG_WIDTH * scale, y * scale + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Ties the page's ambient glow/accent to whatever colors are live. */
  _updateLiveAccent() {
    const root = document.documentElement.style;
    root.setProperty('--live-color-1', this.state.color1);
    root.setProperty('--live-color-2', this.state.color2);
  }

  _setStatus(message) {
    this.elements.statusText.textContent = message;
  }

  /* ---------------- Export ---------------- */

  _downloadPng() {
    const link = document.createElement('a');
    link.download = 'beast-tag.png';
    link.href = this.sourceCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/* ------------------------------------------------------------
   BOOTSTRAP
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  new BeastTagApp();
});
