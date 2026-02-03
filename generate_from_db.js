const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_DIR = __dirname;
const dbFile = path.join(BASE_DIR, 'articles.db');
const htmlTemplate = path.join(BASE_DIR, 'index_sidebar_template.html');
const articleTemplateFile = path.join(BASE_DIR, 'article_template.html');
const outputDir = BASE_DIR;
const articlesSubDir = 'articles';

// Colors for styling
const colors = ['card--blue', 'card--teal', 'card--rust', 'card--moss', 'card--gold', 'card--sky'];
function getRandomColor(index) { return colors[index % colors.length]; }

function formatDate(dateStr) {
    const d = new Date(dateStr);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
}

// Ensure articles subdir exists
const fullArticlesDir = path.join(outputDir, articlesSubDir);
if (!fs.existsSync(fullArticlesDir)) {
    fs.mkdirSync(fullArticlesDir);
}

// 1. Fetch Data from DB
console.log("Fetching articles from DB...");
const query = `SELECT * FROM articles ORDER BY pub_date DESC, id DESC;`;
const jsonStr = execSync(`sqlite3 ${dbFile} -json "${query.replace(/"/g, '\\"')}"`, { maxBuffer: 1024 * 1024 * 200 }).toString();
const allItems = JSON.parse(jsonStr || '[]');

// Read Templates
const articleTemplate = fs.readFileSync(articleTemplateFile, 'utf8');
const indexTemplate = fs.readFileSync(htmlTemplate, 'utf8');

function escapeHtml(str){
  if(!str) return '';
  return String(str).replace(/[&<>\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
}

function cleanExcerpt(str){
  if(!str) return '';
  return String(str).replace(/\bPhotos\b/gi, '').replace(/\s+/g, ' ').trim();
}

let gridHtml = '';
let timelineData = {}; 

console.log(`Generating ${allItems.length} pages...`);

// 2. Generate Pages & Grid
allItems.forEach((item, index) => {
    const pubDate = new Date(item.pub_date);
    const year = pubDate.getFullYear().toString();
    const month = String(pubDate.getMonth() + 1).padStart(2, '0');
    const dateStr = formatDate(item.pub_date);
    const filename = `${item.slug}.html`;
    const relativeLink = `${articlesSubDir}/${filename}`;
    
    // Timeline collection
    if (!timelineData[year]) timelineData[year] = new Set();
    timelineData[year].add(month);
    
    // Generate Article HTML Page - compute prev/next based on current ordering
    const prevItem = index > 0 ? allItems[index - 1] : null;
    const nextItem = index < allItems.length - 1 ? allItems[index + 1] : null;

    const prevHtml = prevItem ? `<a class="prev-link" href="${escapeHtml(prevItem.slug)}.html">← ${escapeHtml(prevItem.title)}</a>` : `<span class="empty"></span>`;
    const nextHtml = nextItem ? `<a class="next-link" href="${escapeHtml(nextItem.slug)}.html">${escapeHtml(nextItem.title)} →</a>` : `<span class="empty"></span>`;

    // Server-side process article content: remove stray 'Photos' tokens and wrap standalone <img> tags into thumbnail anchors
    let contentHtml = item.content || '';
    // remove standalone word 'Photos' (case-insensitive) and collapse repeated whitespace
    contentHtml = String(contentHtml).replace(/\bPhotos\b/gi, '').replace(/\s+/g, ' ');

    // Preserve already-linked images by replacing them with placeholders first
    const linkedPlaceholders = [];
    contentHtml = contentHtml.replace(/<a\b[^>]*>\s*(<img\b[^>]*>)\s*<\/a>/gi, function(match){
      const idx = linkedPlaceholders.length;
      linkedPlaceholders.push(match);
      return `__IMG_LINKED_PLACEHOLDER_${idx}__`;
    });

    // Remove visible standalone 'Photos' text nodes like ">Photos<" but avoid changing file paths
    contentHtml = contentHtml.replace(/>\s*Photos\s*</gi, '><');

    // Replace remaining <img ...> with thumbnail-wrapped anchors
    contentHtml = contentHtml.replace(/<img\b([^>]*)>/gi, function(match, attrs){
      // extract src
      const srcMatch = attrs.match(/src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || srcMatch[3]) : null;
      if(!src) return match;

      // remove width/height attributes to allow responsive sizing
      const cleanedAttrs = attrs.replace(/\s*(width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

      const imgTag = `<img${cleanedAttrs}>`;
      return `<a class="img-thumb" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${imgTag}</a>`;
    });

    // restore previously linked images
    contentHtml = contentHtml.replace(/__IMG_LINKED_PLACEHOLDER_(\d+)__/g, function(m, idx){
      return linkedPlaceholders[Number(idx)] || '';
    });

    let pageContent = articleTemplate
      .replace('href="index.html"', 'href="../home.html"') // Back link now points to home.html
      .replace(/{{TITLE}}/g, item.title)
      .replace(/{{DATE}}/g, dateStr)
      .replace(/{{CONTENT}}/g, contentHtml)
      .replace(/{{PREV_LINK}}/g, prevHtml)
      .replace(/{{NEXT_LINK}}/g, nextHtml);

    fs.writeFileSync(path.join(fullArticlesDir, filename), pageContent);
    
    // Generate Index Card HTML
    const colorClass = getRandomColor(index);
    const safeExcerpt = cleanExcerpt(item.excerpt || '');
    gridHtml += `
    <div class="diary-card ${colorClass} reveal" 
         data-year="${year}" 
         data-month="${month}"
         onclick="window.location.href='${relativeLink}'">
      <span class="card-tag">日志</span>
      <div class="card-date">${dateStr}</div>
      <h3 class="card-title">${item.title}</h3>
      <p class="card-text">${safeExcerpt}</p>
      <div class="card-watercolor"></div>
    </div>\n`;
});

// 3. Generate Sidebar
let sidebarHtml = '';
const sortedYears = Object.keys(timelineData).sort((a, b) => b - a);

sortedYears.forEach(year => {
    const months = Array.from(timelineData[year]).sort((a, b) => b - a);
    let monthsHtml = '';
    months.forEach(m => {
        monthsHtml += `<li class="month-item" onclick="filterByMonth('${year}', '${m}', this)">${m}月</li>`;
    });

    sidebarHtml += `
    <li class="year-item">
      <span class="year-label" onclick="filterByYear('${year}', this)">${year}</span>
      <ul class="month-list">
        ${monthsHtml}
      </ul>
    </li>`;
});

// 4. Update Home (Diary List)
let finalHtml = indexTemplate
    .replace('{{SIDEBAR_CONTENT}}', sidebarHtml)
    .replace('{{GRID_CONTENT}}', gridHtml);

// Inject Audio Player into home.html
const playerHtml = `
<div id="music-player" style="position: fixed; bottom: 20px; right: 20px; z-index: 100; display: flex; align-items: center; background: rgba(255,255,255,0.8); padding: 8px 15px; border-radius: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); backdrop-filter: blur(5px); border: 1px solid rgba(255,255,255,0.5);">
  <button id="play-btn" onclick="toggleMusic()" style="background:none; border:none; cursor:pointer; font-size: 20px; color: #4a7c6f; margin-right:10px;">▶</button>
  <span style="font-size: 12px; color: #555; font-family: sans-serif;">天空之城</span>
  <audio id="bgm" loop>
    <source src="bgm.mp3" type="audio/mpeg">
  </audio>
</div>
<script>
  const audio = document.getElementById('bgm');
  const btn = document.getElementById('play-btn');
  
  // Try autoplay immediately
  audio.volume = 0.4;
  const p = audio.play();
  if (p !== undefined) {
    p.then(() => { btn.innerText = '⏸'; })
     .catch(() => { btn.innerText = '▶'; }); // Autoplay blocked
  }

  function toggleMusic() {
    if (audio.paused) {
      audio.play();
      btn.innerText = '⏸';
    } else {
      audio.pause();
      btn.innerText = '▶';
    }
  }
</script>
</body>`;

finalHtml = finalHtml.replace('</body>', playerHtml);

fs.writeFileSync(path.join(outputDir, 'home.html'), finalHtml);

console.log("Done! Site regenerated (home.html + articles).");
