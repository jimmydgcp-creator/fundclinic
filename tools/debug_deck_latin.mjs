/* 诊断: 演示稿 PDF 里到底少了哪些拉丁字符(中文词元 100% 命中, 但字符多重集有缺口)。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const POPPLER = 'C:\\Users\\75719\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin';
const htmlPath = process.argv[2];
const pdfPath = process.argv[3];

const norm = s => String(s)
  .replace(/[\s\u00a0]+/g, '')
  .replace(/[，。、；：！？（）()【】《》「」“”‘’·—–\-…,.!?;:%"'`|/\\[\]{}<>+=*&#@$^~]/g, '')
  .toLowerCase();

const html = fs.readFileSync(htmlPath, 'utf8');
const slides = [...html.matchAll(/<section class="slide" data-page="(\d+)">([\s\S]*?)<\/section>/g)];
slides.forEach((m, i) => {
  const text = norm(m[2].replace(/<[^>]+>/g, ' '));
  const words = {};
  (text.match(/[a-z]{2,}/g) || []).forEach(w => words[w] = (words[w] || 0) + 1);
  if (Object.keys(words).length) console.log(`第 ${i + 1} 页拉丁串: ` + JSON.stringify(words));
});

const txt = path.join(path.dirname(pdfPath), '_dbg.txt');
execFileSync(path.join(POPPLER, 'pdftotext.exe'), ['-enc', 'UTF-8', '-layout', pdfPath, txt], { stdio: ['ignore', 'pipe', 'ignore'] });
const pdf = norm(fs.readFileSync(txt, 'utf8'));
try { fs.unlinkSync(txt); } catch (e) {}

const allHtml = norm(slides.map(m => m[2].replace(/<[^>]+>/g, ' ')).join(''));
const uniq = [...new Set((allHtml.match(/[a-z]{2,}/g) || []))];
console.log('\nHTML 有而 PDF 没有的拉丁串:');
let any = false;
for (const w of uniq) {
  if (!pdf.includes(w)) { console.log('  ✗ ' + w + '  (HTML x' + (allHtml.match(new RegExp(w, 'g')) || []).length + ')'); any = true; }
}
if (!any) console.log('  (无)');
