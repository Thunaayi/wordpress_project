const $ = id => document.getElementById(id);
let images = [];
let pageTitle = "product";
function safeName(value) {
  return String(value || "product").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "product";
}
function setStatus(message) { $("status").textContent = message; }
function extractImages() {
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const absolute = value => {
    try {
      const url = new URL(value, location.href);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch { return ""; }
  };
  const candidates = [];
  const seen = new Set();
  const add = (raw, alt = "", width = 0, height = 0, source = "image") => {
    const url = absolute(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({url, alt:clean(alt), width:Number(width)||0, height:Number(height)||0, source});
  };
  const bestSrcset = value => {
    if (!value) return "";
    const choices = value.split(",").map(item => {
      const parts = item.trim().split(/\s+/);
      const descriptor = parts[1] || "1x";
      const amount = parseFloat(descriptor) || 1;
      return {url:parts[0], amount:descriptor.endsWith("w") ? amount / 1000 : amount};
    }).filter(item => item.url);
    choices.sort((a,b)=>b.amount-a.amount);
    return choices[0]?.url || "";
  };
  for (const img of document.querySelectorAll("img")) {
    const url = img.getAttribute("data-zoom-image") ||
      img.getAttribute("data-large_image") || img.getAttribute("data-original") ||
      img.getAttribute("data-lazy-src") || img.getAttribute("data-src") ||
      bestSrcset(img.getAttribute("data-srcset") || img.getAttribute("srcset")) ||
      img.currentSrc || img.src;
    add(url, img.alt, img.naturalWidth || img.width, img.naturalHeight || img.height, "img");
  }
  for (const source of document.querySelectorAll("picture source[srcset], source[data-srcset]")) {
    add(bestSrcset(source.getAttribute("data-srcset") || source.getAttribute("srcset")), source.parentElement?.querySelector("img")?.alt, 0, 0, "picture");
  }
  for (const link of document.querySelectorAll("a[href]")) {
    const img = link.querySelector("img");
    if (img) {
      let path = "";
      try { path = new URL(link.href).pathname; } catch {}
      if (/\.(?:jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(path)) add(link.href, img.alt, img.naturalWidth, img.naturalHeight, "image link");
    }
  }
  for (const meta of document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]')) {
    add(meta.content, "Page preview image", 0, 0, "page metadata");
  }
  for (const el of document.querySelectorAll("[style*='background-image'], [data-image], [data-background]")) {
    const style = el.getAttribute("style") || "";
    const match = style.match(/background-image\s*:\s*url\(["']?(.*?)["']?\)/i);
    add(match?.[1] || el.getAttribute("data-image") || el.getAttribute("data-background"), el.getAttribute("aria-label") || el.title, 0, 0, "background");
  }
  return {title:document.title || location.hostname, url:location.href, images:candidates};
}
async function scan() {
  $("scan").disabled = true;
  setStatus("Finding images on this page…");
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) throw new Error("Open a normal website page first.");
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractImages});
    const data = result?.[0]?.result;
    if (!data || !Array.isArray(data.images)) throw new Error("The page did not return images. Reload it and scan again.");
    images = data.images;
    pageTitle = data.title || "product";
    $("prefix").value = safeName(pageTitle);
    $("source").textContent = data.url;
    renderImages();
    $("results").hidden = false;
    setStatus(images.length ? "Found " + images.length + " image URLs. Uncheck anything you do not want, then download." : "No image URLs found. Try scrolling the page to load lazy images, then scan again.");
  } catch (error) {
    setStatus("Scan failed: " + (error?.message || error));
  } finally {
    $("scan").disabled = false;
  }
}
function renderImages() {
  const list = $("images");
  $("count").textContent = images.length + " image URL" + (images.length === 1 ? "" : "s");
  list.replaceChildren();
  images.forEach((item,index)=>{
    const row=document.createElement("label");
    row.className="image-row";
    const check=document.createElement("input");
    check.type="checkbox"; check.checked=true; check.dataset.index=String(index);
    const thumb=document.createElement("img");
    thumb.className="thumb"; thumb.loading="lazy"; thumb.alt="";
    thumb.src=item.url;
    thumb.onerror=()=>{thumb.classList.add("broken");thumb.removeAttribute("src");};
    const details=document.createElement("span"); details.className="details";
    const title=document.createElement("strong");
    title.textContent=String(index+1).padStart(2,"0")+". "+(item.alt || item.source || "Image");
    const sub=document.createElement("small");
    let host=""; try{host=new URL(item.url).hostname;}catch{}
    sub.textContent=(item.width && item.height ? item.width+" × "+item.height+" · " : "")+host+" · "+item.url.split("/").pop().split("?")[0].slice(0,42);
    details.append(title,sub); row.append(check,thumb,details); list.append(row);
  });
  $("selectAll").textContent="Select none";
}
function chooseAll(checked) {
  $("images").querySelectorAll('input[type="checkbox"]').forEach(input=>input.checked=checked);
  $("selectAll").textContent=checked ? "Select none" : "Select all";
}
async function downloadSelected() {
  const selected=[...$("images").querySelectorAll('input[type="checkbox"]:checked')]
    .map(input=>({item:images[Number(input.dataset.index)],index:Number(input.dataset.index)}))
    .filter(entry=>entry.item);
  if(!selected.length){setStatus("Select at least one image.");return;}
  const prefix=safeName($("prefix").value || pageTitle);
  $("download").disabled=true;
  let success=0,failed=0;
  setStatus("Starting "+selected.length+" image downloads…");
  for(let i=0;i<selected.length;i++){
    const item=selected[i].item;
    let ext="jpg";
    try {
      const url=new URL(item.url);
      const match=url.pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
      if(match && ["jpg","jpeg","png","webp","gif","avif","bmp","svg"].includes(match[1].toLowerCase())) ext=match[1].toLowerCase();
    } catch {}
    if(ext==="jpeg") ext="jpg";
    const filename="Techistics-Images/"+prefix+"/"+prefix+"-"+String(i+1).padStart(2,"0")+"."+ext;
    try {
      await chrome.downloads.download({url:item.url,filename,conflictAction:"uniquify",saveAs:false});
      success++;
    } catch (error) { failed++; }
    setStatus("Queued "+(i+1)+"/"+selected.length+" · "+success+" started · "+failed+" failed");
  }
  setStatus("Finished requesting downloads.\nStarted: "+success+"\nFailed to start: "+failed+"\nFolder: Techistics-Images/"+prefix+"/\n\nIf some files fail, the source site may block direct downloads or require you to open the image first.");
  $("download").disabled=false;
}
$("scan").addEventListener("click",scan);
$("rescan").addEventListener("click",scan);
$("selectAll").addEventListener("click",()=> {
  const boxes=[...$("images").querySelectorAll('input[type="checkbox"]')];
  chooseAll(boxes.some(box=>!box.checked));
});
$("download").addEventListener("click",downloadSelected);
