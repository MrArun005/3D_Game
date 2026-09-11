/**
 * GPU Detection and Quality Mode Resolution.
 *
 * WebGPU device objects do not expose adapterInfo directly (adapterInfo is a property
 * of GPUAdapter, not GPUDevice). This module queries adapter info safely across WebGPU
 * implementations, falls back to WebGL unmasked debug renderer info, and reliably
 * classifies low-power/integrated graphics architectures (Intel UHD/Iris/Xe/Ultra,
 * Apple Silicon, AMD APUs/Radeon 680M/780M, ARM Mali, Qualcomm Adreno).
 */

export const INTEGRATED_GPU_REGEX =
  /intel|apple|mali|adreno|qualcomm|arm\b|radeon.*(graphics|vega|680m|780m|890m)|uhd|iris|xe\b/i;

/**
 * Robustly inspect GPU hardware vendor and model strings across WebGPU and WebGL contexts.
 *
 * @param {import('three').WebGPURenderer} [renderer]
 * @returns {Promise<{ vendor: string, architecture: string, description: string, gpuDesc: string, isIntegrated: boolean }>}
 */
export async function detectGpuInfo(renderer = null) {
  let vendor = '';
  let architecture = '';
  let description = '';

  // 1. Inspect Three.js WebGPU backend adapter
  const adapter = renderer?.backend?.adapter;
  if (adapter) {
    if (adapter.info) {
      vendor = adapter.info.vendor || '';
      architecture = adapter.info.architecture || '';
      description = adapter.info.description || adapter.info.device || '';
    } else if (typeof adapter.requestAdapterInfo === 'function') {
      try {
        const info = await adapter.requestAdapterInfo();
        vendor = info.vendor || '';
        architecture = info.architecture || '';
        description = info.description || info.device || '';
      } catch (_) {
        // requestAdapterInfo may reject or be unpermitted
      }
    }
  }

  // 2. Query navigator.gpu directly if vendor is still unspecified or generic
  if ((!vendor || vendor.toLowerCase() === 'google') && typeof navigator !== 'undefined' && navigator.gpu?.requestAdapter) {
    try {
      const navAdapter = await navigator.gpu.requestAdapter();
      if (navAdapter?.info) {
        if (!vendor || vendor.toLowerCase() === 'google') vendor = navAdapter.info.vendor || vendor;
        architecture = architecture || navAdapter.info.architecture || '';
        description = description || navAdapter.info.description || navAdapter.info.device || '';
      } else if (typeof navAdapter?.requestAdapterInfo === 'function') {
        const info = await navAdapter.requestAdapterInfo();
        if (!vendor || vendor.toLowerCase() === 'google') vendor = info.vendor || vendor;
        architecture = architecture || info.architecture || '';
        description = description || info.description || info.device || '';
      }
    } catch (_) {}
  }

  // 3. WebGL UNMASKED_RENDERER_WEBGL fallback
  // On Windows Chromium/Edge/Firefox, this reliably returns strings like:
  // "ANGLE (Intel, Intel(R) Graphics (0x00007D45) Direct3D11 vs_5_0 ps_5_0, D3D11)"
  if (typeof document !== 'undefined') {
    try {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '';
          const unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
          if (unmaskedVendor && (!vendor || vendor.toLowerCase() === 'google')) {
            vendor = unmaskedVendor;
          }
          if (unmaskedRenderer) {
            description = description ? `${description} (${unmaskedRenderer})` : unmaskedRenderer;
          }
        }
      }
    } catch (_) {}
  }

  const gpuDesc = [vendor, architecture, description].filter(Boolean).join(' ');
  const isIntegrated = INTEGRATED_GPU_REGEX.test(gpuDesc);

  return {
    vendor,
    architecture,
    description,
    gpuDesc,
    isIntegrated,
  };
}

/**
 * Determine whether LITE quality mode should be active.
 *
 * Order of precedence:
 * 1. URL search params: ?lite forces LITE, ?full forces FULL
 * 2. Saved preference in localStorage ('hb.quality' === 'lite' | 'full')
 * 3. Hardware detection: integrated GPU -> LITE, discrete GPU -> FULL
 *
 * @param {{ isIntegrated: boolean }} gpuInfo
 * @param {string} [search] Optional search string, defaults to location.search
 * @returns {{ isLite: boolean, reason: string }}
 */
export function resolveQualityMode(gpuInfo, search = null) {
  const queryStr = search !== null ? search : (typeof location !== 'undefined' ? location.search : '');
  const q = new URLSearchParams(queryStr);

  if (q.has('lite')) {
    return { isLite: true, reason: 'URL parameter ?lite' };
  }
  if (q.has('full')) {
    return { isLite: false, reason: 'URL parameter ?full' };
  }

  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('hb.quality') : null;
    if (saved === 'lite') return { isLite: true, reason: 'Saved preference (localStorage: lite)' };
    if (saved === 'full') return { isLite: false, reason: 'Saved preference (localStorage: full)' };
  } catch (_) {}

  if (gpuInfo?.isIntegrated) {
    return { isLite: true, reason: 'Auto-detected integrated GPU architecture' };
  }

  return { isLite: false, reason: 'Auto-detected discrete GPU or default' };
}
