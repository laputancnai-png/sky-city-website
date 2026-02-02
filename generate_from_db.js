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
const query = `SELECT * FROM articles ORDER BY pub_date DESC;`;
const jsonStr = execSync(`sqlite3 ${dbFile} -json "${query.replace(/"/g, '\\"')}"`).toString();
const allItems = JSON.parse(jsonStr || '[]');

// Read Templates
const articleTemplate = fs.readFileSync(articleTemplateFile, 'utf8');
const indexTemplate = fs.readFileSync(htmlTemplate, 'utf8');

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
    
    // Generate Article HTML Page
    let pageContent = articleTemplate
        .replace('href="index.html"', 'href="../home.html"') // Back link now points to home.html
        .replace(/{{TITLE}}/g, item.title)
        .replace(/{{DATE}}/g, dateStr)
        .replace(/{{CONTENT}}/g, item.content);
        
    fs.writeFileSync(path.join(fullArticlesDir, filename), pageContent);
    
    // Generate Index Card HTML
    const colorClass = getRandomColor(index);
    gridHtml += `
    <div class="diary-card ${colorClass} reveal" 
         data-year="${year}" 
         data-month="${month}"
         onclick="window.location.href='${relativeLink}'">
      <span class="card-tag">日志</span>
      <div class="card-date">${dateStr}</div>
      <h3 class="card-title">${item.title}</h3>
      <p class="card-text">${item.excerpt}</p>
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
