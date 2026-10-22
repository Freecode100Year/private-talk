#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, process.argv[2] || '_site');

// 1. Read package.json for version
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;
if (!version) throw new Error('package.json missing version');

// 2. Read README.md for dynamic APK links
const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');

const apkOnlineMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/download\/android-online-[^\s\)\"]+\.apk/);
const apkOfflineMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/download\/android-offline-[^\s\)\"]+\.apk/);
const apkOnlineTagMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/tag\/android-online-[^\s\)\"]+/);
const apkOfflineTagMatch = readme.match(/https:\/\/github\.com\/Freecode100Year\/private-talk\/releases\/tag\/android-offline-[^\s\)\"]+/);

if (!apkOnlineMatch) throw new Error('Could not find android-online APK link in README.md');
if (!apkOfflineMatch) throw new Error('Could not find android-offline APK link in README.md');
if (!apkOnlineTagMatch) throw new Error('Could not find android-online tag link in README.md');
if (!apkOfflineTagMatch) throw new Error('Could not find android-offline tag link in README.md');

const placeholders = {
  '{{VERSION}}': version,
  '{{APK_ONLINE}}': apkOnlineMatch[0],
  '{{APK_OFFLINE}}': apkOfflineMatch[0],
  '{{APK_ONLINE_TAG}}': apkOnlineTagMatch[0],
  '{{APK_OFFLINE_TAG}}': apkOfflineTagMatch[0],
  '{{IOS_SHORTCUT}}': 'https://www.icloud.com/shortcuts/196e890920d14049a2de8c813d5244d0',
  '{{RELEASES_LATEST}}': 'https://github.com/Freecode100Year/private-talk/releases/latest'
};

// 3. Prepare destination directories (from scratch: no stale files)
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'en'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'img'), { recursive: true });

// 4. Copy style.css
const cssSrc = path.join(rootDir, 'pages', 'style.css');
if (!fs.existsSync(cssSrc)) throw new Error('pages/style.css not found');
fs.copyFileSync(cssSrc, path.join(outDir, 'style.css'));

// 5. Process HTML files with placeholder replacement
const htmlFiles = [
  { src: path.join(rootDir, 'pages', 'index.html'), dest: path.join(outDir, 'index.html') },
  { src: path.join(rootDir, 'pages', 'en', 'index.html'), dest: path.join(outDir, 'en', 'index.html') }
];

const processedHtml = [];

for (const { src, dest } of htmlFiles) {
  if (!fs.existsSync(src)) throw new Error(`Source HTML file not found: ${src}`);
  let content = fs.readFileSync(src, 'utf8');

  for (const [key, value] of Object.entries(placeholders)) {
    content = content.split(key).join(value);
  }

  const remaining = content.match(/\{\{[^}]+\}\}/g);
  if (remaining) {
    throw new Error(`Unreplaced placeholders in ${src}: ${remaining.join(', ')}`);
  }

  fs.writeFileSync(dest, content, 'utf8');
  processedHtml.push({ path: dest, content });
}

// 6. Find and copy all referenced images to _site/img/
const imageRefs = new Set();
const imgRegex = /(?:src|href)=["'](?:(?:\.\.\/)?img\/)([^"']+)["']/g;

for (const { content } of processedHtml) {
  for (const match of content.matchAll(imgRegex)) {
    imageRefs.add(match[1]);
  }
}

const docsImagesDir = path.join(rootDir, 'docs', 'images');
const docsScreenshotsDir = path.join(rootDir, 'docs', 'screenshots');

for (const imgName of imageRefs) {
  const fromImages = path.join(docsImagesDir, imgName);
  const fromScreenshots = path.join(docsScreenshotsDir, imgName);

  let foundSrc = null;
  if (fs.existsSync(fromImages)) {
    foundSrc = fromImages;
  } else if (fs.existsSync(fromScreenshots)) {
    foundSrc = fromScreenshots;
  }

  if (!foundSrc) {
    throw new Error(`Referenced image not found in docs/images or docs/screenshots: ${imgName}`);
  }

  fs.copyFileSync(foundSrc, path.join(outDir, 'img', imgName));
}

// 7. Verify all local links and image paths in generated pages
for (const { path: htmlPath, content } of processedHtml) {
  const htmlDir = path.dirname(htmlPath);
  const refRegex = /<(?:a|link|img|source)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;

  for (const match of content.matchAll(refRegex)) {
    const rawRef = match[1].trim();

    // Ignore remote URLs, mailto, data URIs, and pure hash fragments
    if (!rawRef || /^(?:https?:\/\/|mailto:|data:|#)/i.test(rawRef)) {
      continue;
    }

    // Strip hash and query from path
    const cleanRef = rawRef.split('#')[0].split('?')[0];
    if (!cleanRef) {
      continue;
    }

    let targetPath = path.resolve(htmlDir, cleanRef);

    // If pointing to a directory or ending with '/', check for index.html
    if (cleanRef.endsWith('/') || (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory())) {
      targetPath = path.join(targetPath, 'index.html');
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`Broken local reference in ${htmlPath}: "${rawRef}" resolved to missing file "${targetPath}"`);
    }
  }
}

console.log(`Pages build complete: ${outDir} (${imageRefs.size} images copied, 2 HTML pages generated)`);
