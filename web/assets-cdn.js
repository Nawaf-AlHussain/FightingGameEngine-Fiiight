// assets-cdn.js -- Fetches characters and stages from the Assets repo on GitHub.
// Hooks into the fs-shim's virtual filesystem: when the engine tries to open
// a file under chars/ or stages/ that doesn't exist in the bundled content,
// this module fetches it from the Assets repo via a CORS proxy.
//
// The manifest is fetched once at boot from /api/assets-manifest (or directly
// from GitHub raw). Characters are listed in select.def dynamically.
"use strict";

(() => {
  const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/FightingGameEngine/Assets/main/";
  const MANIFEST_URL = GITHUB_RAW_BASE + "manifest.json";

  let manifest = null;
  let charIndex = new Map(); // charId -> { cdnBase, files, displayName }
  let stageIndex = new Map(); // stageId -> { cdnBase, files, displayName }

  // Fetch the manifest from GitHub raw
  async function fetchManifest() {
    if (manifest) return manifest;
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error("Manifest HTTP " + res.status);
      manifest = await res.json();
      for (const c of manifest.characters || []) {
        charIndex.set(c.id, c);
      }
      for (const s of manifest.stages || []) {
        stageIndex.set(s.id, s);
      }
      console.log(`[assets-cdn] Manifest loaded: ${charIndex.size} chars, ${stageIndex.size} stages`);
      return manifest;
    } catch (e) {
      console.error("[assets-cdn] Failed to fetch manifest:", e);
      manifest = { characters: [], stages: [] };
      return manifest;
    }
  }

  // Fetch a single file from the Assets repo
  async function fetchAsset(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Asset HTTP ${res.status}: ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // Given a VFS path like "chars/Songoku/Songoku.def", find the matching
  // character in the manifest and return its file list.
  function findCharByPath(path) {
    // path = chars/<id>/<file>
    const parts = path.split("/");
    if (parts.length < 3) return null;
    const charId = parts[1];
    return charIndex.get(charId) || null;
  }

  function findStageByPath(path) {
    // path = stages/<file>
    const parts = path.split("/");
    if (parts.length < 2) return null;
    const fileName = parts[parts.length - 1];
    // Stages in the Assets repo are flat files, not directories
    for (const [id, s] of stageIndex) {
      if (s.files && s.files.includes(fileName)) return s;
    }
    return null;
  }

  // Check if a path should be fetched from the Assets CDN
  function isAssetPath(path) {
    return path.startsWith("chars/") || path.startsWith("/chars/") ||
           path.startsWith("stages/") || path.startsWith("/stages/");
  }

  // Fetch a file from the Assets repo and inject it into the VFS
  async function fetchAndInject(vfsPath) {
    if (!manifest) await fetchManifest();

    const cleanPath = vfsPath.replace(/^\//, "");

    if (cleanPath.startsWith("chars/")) {
      const char = findCharByPath(cleanPath);
      if (!char) return null;

      const fileName = cleanPath.split("/").slice(2).join("/");
      const url = GITHUB_RAW_BASE + "chars/" + char.id + "/" + fileName;
      console.log(`[assets-cdn] Fetching ${char.id}/${fileName}`);
      return await fetchAsset(url);
    }

    if (cleanPath.startsWith("stages/")) {
      const fileName = cleanPath.split("/").pop();
      const url = GITHUB_RAW_BASE + "stages/" + fileName;
      console.log(`[assets-cdn] Fetching stage ${fileName}`);
      return await fetchAsset(url);
    }

    return null;
  }

  // Generate a select.def that lists all available characters and stages
  function generateSelectDef() {
    let lines = "";
    lines += "; Auto-generated select.def from Assets manifest\n";
    lines += "; Do not edit — regenerated on each boot\n\n";
    lines += "[Options]\n";
    lines += "arcade.maxmatches = 1,0,0,0,0,0,0,0,0,0\n";
    lines += "team.maxmatches = 1,0,0,0,0,0,0,0,0,0\n";
    lines += "survival.maxmatches = 1,0,0,0,0,0,0,0,0,0\n\n";
    lines += "[Characters]\n";

    for (const c of manifest.characters || []) {
      // Use the character's .def file path relative to chars/
      const defFile = c.files.find(f => f.endsWith(".def")) || (c.id + ".def");
      lines += `${c.id}/${defFile}, stages/${(manifest.stages || [])[0]?.id || "stage0.def"}\n`;
    }

    lines += "\n[ExtraStages]\n";
    for (const s of manifest.stages || []) {
      const defFile = s.files.find(f => f.endsWith(".def")) || s.id;
      lines += `stages/${defFile}\n`;
    }

    return lines;
  }

  // Preload a character's files into the VFS (called when user selects a char)
  async function preloadCharacter(charId, injectFn) {
    if (!manifest) await fetchManifest();
    const char = charIndex.get(charId);
    if (!char) return;

    console.log(`[assets-cdn] Preloading character: ${charId} (${char.files.length} files)`);
    for (const file of char.files) {
      const vfsPath = `chars/${charId}/${file}`;
      const url = GITHUB_RAW_BASE + "chars/" + charId + "/" + file;
      try {
        const data = await fetchAsset(url);
        injectFn(vfsPath, data);
      } catch (e) {
        console.warn(`[assets-cdn] Failed to fetch ${vfsPath}:`, e.message);
      }
    }
  }

  // Preload a stage's files into the VFS
  async function preloadStage(stageId, injectFn) {
    if (!manifest) await fetchManifest();
    const stage = stageIndex.get(stageId);
    if (!stage) return;

    console.log(`[assets-cdn] Preloading stage: ${stageId}`);
    for (const file of stage.files || [stageId]) {
      const vfsPath = `stages/${file}`;
      const url = GITHUB_RAW_BASE + "stages/" + file;
      try {
        const data = await fetchAsset(url);
        injectFn(vfsPath, data);
      } catch (e) {
        console.warn(`[assets-cdn] Failed to fetch ${vfsPath}:`, e.message);
      }
    }
  }

  // Expose API
  window.__assetsCDN = {
    fetchManifest,
    fetchAndInject,
    generateSelectDef,
    preloadCharacter,
    preloadStage,
    isAssetPath,
    getCharacters: () => manifest?.characters || [],
    getStages: () => manifest?.stages || [],
  };
})();
