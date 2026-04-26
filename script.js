/* ── DocCluster AI - Smart Frontend Logic ── */

const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e'];

// State
let stagedFiles = [];
let stagedRawDocs = [];
let clusterState = null; 
let chartInstance = null;

// --- 1. UI SETUP (Drag & Drop) ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');

// Smooth Drag & Drop
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        
        const items = e.dataTransfer.items;
        if (items) {
            let files = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i].webkitGetAsEntry();
                if (item) await traverseFileTree(item, files);
            }
            const allowedExtensions = ['.txt', '.pdf', '.docx', '.csv'];
            const validFiles = files.filter(f => {
                const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
                return allowedExtensions.includes(ext);
            });
            handleFiles(validFiles);
        } else {
            handleFiles(e.dataTransfer.files);
        }
    });
}

function traverseFileTree(item, files) {
    return new Promise((resolve) => {
        if (item.isFile) {
            item.file((file) => {
                files.push(file);
                resolve();
            });
        } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(async (entries) => {
                for (let i = 0; i < entries.length; i++) {
                    await traverseFileTree(entries[i], files);
                }
                resolve();
            });
        }
    });
}

fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
if(folderInput) {
    folderInput.addEventListener('change', (e) => {
        const allowedExtensions = ['.txt', '.pdf', '.docx', '.csv'];
        const files = Array.from(e.target.files).filter(f => {
            const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
            return allowedExtensions.includes(ext);
        });
        handleFiles(files);
    });
}

function handleFiles(files) {
    for(let f of files) { stagedFiles.push(f); }
    renderStagedFiles();
}

function addPastedText() {
    const text = document.getElementById('doc-input').value.trim();
    if(text) {
        let lines = text.split('\n').filter(l => l.trim().length > 10);
        stagedRawDocs.push(...lines);
        document.getElementById('doc-input').value = '';
        renderStagedFiles();
    }
}

function renderStagedFiles() {
    const list = document.getElementById('staged-list');
    const container = document.getElementById('staged-files-container');
    const countEl = document.getElementById('staged-count');
    
    if (stagedFiles.length === 0 && stagedRawDocs.length === 0) {
        container.classList.add('hidden');
        countEl.innerText = "0";
        return;
    }

    container.classList.remove('hidden');
    
    let html = '';
    stagedFiles.forEach((f, i) => {
        html += `<li>
            <span><i class="fa-solid fa-file-lines" style="color:var(--accent-primary); margin-right:8px;"></i> ${f.name}</span>
            <button class="btn-text" onclick="removeFile(${i})" style="color:var(--danger);">Remove</button>
        </li>`;
    });
    if(stagedRawDocs.length > 0) {
        html += `<li>
            <span><i class="fa-solid fa-align-left" style="color:var(--accent-secondary); margin-right:8px;"></i> ${stagedRawDocs.length} Pasted Documents</span>
            <button class="btn-text" onclick="clearRaw()" style="color:var(--danger);">Clear</button>
        </li>`;
    }
    list.innerHTML = html;
    countEl.innerText = stagedFiles.length + stagedRawDocs.length;
}

function removeFile(index) { stagedFiles.splice(index, 1); renderStagedFiles(); }
function clearRaw() { stagedRawDocs = []; renderStagedFiles(); }
function clearAllStaged() { stagedFiles = []; stagedRawDocs = []; renderStagedFiles(); }

function updateKValue(val) {
    document.getElementById('k-bubble').innerText = val;
    document.getElementById('k-display').innerText = val;
}

// --- 2. SAMPLE DATA ---
function loadSampleDocs() {
    stagedRawDocs = [
        "The government passed a new tax reform bill affecting middle class families across the country.",
        "Congress debates new immigration policies and federal infrastructure budget.",
        "Scientists discover a new exoplanet that could potentially support liquid water.",
        "Research team develops breakthrough cancer treatment using CRISPR gene editing.",
        "Champions League final saw dramatic penalty shootout as home team wins the trophy.",
        "Olympic sprinter breaks 100m world record at national championships.",
        "Tech giant announces new AI-powered smartphone with revolutionary camera features.",
        "Startup raises $500M in Series B funding for commercial quantum computing systems.",
        "Federal Reserve announces interest rate hike amid concerns about rising inflation.",
        "Cryptocurrency markets see massive volatility as regulatory frameworks tighten.",
        "My laptop screen is flickering and the battery drains within 30 minutes. Need support.",
        "Cannot reset my password, the recovery email never arrives in my inbox.",
        "Software installation failed with Error Code 504 during the resolving dependencies step.",
        "User account locked after 5 failed login attempts. Please reset active sessions.",
        "Study Notes: Mitochondria is the powerhouse of the cell, responsible for ATP production."
    ];
    renderStagedFiles();
}

// --- 3. CLUSTERING PIPELINE ---
async function runClustering() {
    if(stagedFiles.length === 0 && stagedRawDocs.length === 0) {
        alert("Please upload some files or paste text first!");
        return;
    }
    
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('error-msg').classList.add('hidden');
    
    const formData = new FormData();
    formData.append('n_clusters', document.getElementById('k-slider').value);
    formData.append('custom_names', document.getElementById('custom-names').value);
    
    if(stagedRawDocs.length > 0) formData.append('raw_documents', JSON.stringify(stagedRawDocs));
    stagedFiles.forEach(f => formData.append('files', f));

    try {
        const response = await fetch('/cluster', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error || 'Server error');
        
        buildUI(data);
    } catch(err) {
        const errEl = document.getElementById('error-msg');
        errEl.innerText = "❌ " + err.message;
        errEl.classList.remove('hidden');
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

// --- 4. RENDER RESULTS ---
function buildUI(data) {
    const { cluster_info, n_clusters, coords } = data;
    const grid = document.getElementById('folder-grid');
    grid.innerHTML = '';
    
    clusterState = []; 
    
    for (let c = 0; c < n_clusters; c++) {
        const info = cluster_info[c];
        if(!info) continue;
        const color = COLORS[c % COLORS.length];
        
        clusterState.push({ id: c, name: info.name, color: color, docs: info.docs });
        
        let chips = info.keywords.map(k => `<span class="chip">${k}</span>`).join('');
        let docsHtml = info.docs.map(doc => `
            <div class="doc-item" data-title="${doc.title}" data-conf="${doc.confidence}" data-text="${encodeURIComponent(doc.text)}">
                <div class="doc-title">
                    <span>${doc.title} <span class="badge" style="color:${color}">${doc.confidence}%</span></span>
                </div>
                <div class="doc-preview">${doc.text.substring(0,60)}...</div>
            </div>
        `).join('');

        grid.innerHTML += `
            <div class="folder-card" style="--folder-color: ${color}">
                <div class="folder-header" onclick="this.parentElement.classList.toggle('expanded')">
                    <h3><i class="fa-solid fa-folder"></i> ${info.name}</h3>
                    <span class="badge">${info.count} files</span>
                </div>
                <div class="chip-container">${chips}</div>
                <div class="file-list" data-cluster-id="${c}">${docsHtml}</div>
            </div>
        `;
    }
    
    document.getElementById('results').classList.remove('hidden');
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
    
    // SortableJS init
    const lists = document.querySelectorAll('.file-list');
    lists.forEach(el => {
        new Sortable(el, {
            group: 'shared', 
            animation: 150,
            onEnd: function () {
                syncStateFromUI(); 
            }
        });
    });
    
    drawChart(coords);
}

function syncStateFromUI() {
    const folders = document.querySelectorAll('.folder-card');
    clusterState = [];
    folders.forEach((card, index) => {
        const header = card.querySelector('.folder-header h3').innerText.trim();
        const listContainer = card.querySelector('.file-list');
        const docDrops = listContainer.querySelectorAll('.doc-item');
        
        let newDocs = [];
        docDrops.forEach(el => {
            newDocs.push({
                title: el.getAttribute('data-title'),
                text: decodeURIComponent(el.getAttribute('data-text')),
                confidence: el.getAttribute('data-conf')
            });
        });
        
        const badge = card.querySelector('.folder-header .badge');
        if(badge) badge.innerText = `${newDocs.length} files`;
        
        clusterState.push({ name: header, docs: newDocs });
    });
}

// --- 5. CHARTS & FILTERS ---
function drawChart(coords) {
    if(chartInstance) chartInstance.destroy();
    const datasets = clusterState.map((cluster, c) => {
        return {
            label: cluster.name,
            data: coords.filter(dot => dot.cluster == c).map(dot => ({ x: dot.x, y: dot.y, title: dot.title })),
            backgroundColor: COLORS[c % COLORS.length] + 'cc',
            borderColor: COLORS[c % COLORS.length],
            pointRadius: 6, pointHoverRadius: 9
        };
    });
    
    const ctx = document.getElementById('scatter-chart').getContext('2d');
    chartInstance = new Chart(ctx, {
        type: 'scatter', data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.title}` } },
                legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } }
            },
            scales: {
                x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

function filterDocuments() {
    const q = document.getElementById('search-input').value.toLowerCase();
    document.querySelectorAll('.doc-item').forEach(item => {
        const text = decodeURIComponent(item.getAttribute('data-text')).toLowerCase();
        const title = item.getAttribute('data-title').toLowerCase();
        
        if(text.includes(q) || title.includes(q)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

// --- 6. EXPORTS ---
function downloadZip() {
    const zip = new JSZip();
    clusterState.forEach((folder) => {
        const cleanFolderName = folder.name.replace(/[^a-zA-Z0-9 ]/g, "").trim() || "Folder";
        const folderZip = zip.folder(cleanFolderName); 
        folder.docs.forEach((doc) => {
            let filename = doc.title;
            if(!filename.includes('.')) filename += '.txt';
            folderZip.file(filename, doc.text);
        });
    });
    
    zip.generateAsync({type:"blob"}).then(content => {
        saveAs(content, "DocCluster_AI_Export.zip");
    });
}

function downloadCSV() {
    let csvContent = "Filename,Assigned Folder,Confidence Score\n";
    clusterState.forEach(folder => {
        const cleanName = folder.name.replace(/,/g, ''); 
        folder.docs.forEach(doc => {
            const cleanTitle = doc.title.replace(/,/g, '');
            csvContent += `${cleanTitle},${cleanName},${doc.confidence}%\n`;
        });
    });
    saveAs(new Blob([csvContent], {type: "text/csv;charset=utf-8"}), "DocCluster_AI_Report.csv");
}
