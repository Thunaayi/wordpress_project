const $ = id => document.getElementById(id);
let capture = null;
const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
function safeName(value) {
  return String(value || "product").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
}
function status(message) { $("status").textContent = message; }
function extractProduct() {
  const cleanText = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const txt = el => cleanText(el?.innerText || el?.textContent || "");
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const abs = value => { try { return new URL(value, location.href).href; } catch { return ""; } };
  const meta = selector => document.querySelector(selector)?.content || "";
  const products = [];
  function visitJson(value) {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visitJson);
    if (typeof value !== "object") return;
    if (value["@graph"]) visitJson(value["@graph"]);
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some(type => String(type).toLowerCase() === "product")) products.push(value);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { visitJson(JSON.parse(script.textContent)); } catch {}
  }
  const structured = products.find(p => p.name) || {};
  const firstText = selectors => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && txt(el)) return txt(el);
    }
    return "";
  };
  const offers = Array.isArray(structured.offers) ? structured.offers[0] : structured.offers;
  let price = offers?.price != null ? String(offers.price) : "";
  if (!price) price = firstText([
    ".summary .price .woocommerce-Price-amount", ".summary .price",
    ".product .price .woocommerce-Price-amount", ".product .price",
    "[itemprop='price']"
  ]);
  if (!price) price = meta('meta[property="product:price:amount"]') || meta('meta[itemprop="price"]');
  const name = clean(structured.name) || firstText(["h1.product_title", ".product_title", "main .product h1", "main h1", "h1"]);
  let description = clean(structured.description || "");
  if (!description) description = firstText([
    "#tab-description", ".woocommerce-Tabs-panel--description",
    ".woocommerce-product-details__short-description", ".product-description",
    "[itemprop='description']"
  ]);
  if (!description) description = meta('meta[name="description"]');
  const brandObject = structured.brand;
  let brand = typeof brandObject === "string" ? brandObject : brandObject?.name || "";
  if (!brand) brand = firstText(["[itemprop='brand']", ".product_meta .brand", ".product-brand"]);
  const sku = clean(structured.sku || firstText([".product_meta .sku", ".sku_wrapper .sku", "[itemprop='sku']"]));
  const specs = [], specKeys = new Set();
  const addSpec = (name, value) => {
    name = clean(name).replace(/:$/, ""); value = clean(value);
    if (!name || !value || name.length > 120 || value.length > 500 || name.toLowerCase() === value.toLowerCase()) return;
    const key = name.toLowerCase() + "|" + value.toLowerCase();
    if (!specKeys.has(key)) { specKeys.add(key); specs.push({name, value}); }
  };
  // Structured Product additionalProperty fields.
  for (const property of (Array.isArray(structured.additionalProperty) ? structured.additionalProperty : structured.additionalProperty ? [structured.additionalProperty] : [])) {
    addSpec(property.name, property.value);
  }
  // WooCommerce and common product specification tables only.
  const specRoots = [
    ".woocommerce-product-attributes", "table.shop_attributes", "#tab-additional_information",
    ".woocommerce-Tabs-panel--additional_information", ".product-specs", ".specifications",
    ".product-specifications", ".technical-specifications", ".product-details"
  ];
  const roots = [...new Set(specRoots.flatMap(selector => [...document.querySelectorAll(selector)]))];
  for (const root of roots) {
    for (const row of root.querySelectorAll("tr")) {
      const cells = [...row.querySelectorAll("th,td")].map(txt).filter(Boolean);
      if (cells.length >= 2) addSpec(cells[0], cells.slice(1).join(" "));
    }
    const dts = [...root.querySelectorAll("dt")], dds = [...root.querySelectorAll("dd")];
    dts.forEach((dt, i) => addSpec(txt(dt), txt(dds[i])));
  }
  // Product-only gallery; if absent, use images inside the primary product content,
  // never the whole document.
  const gallerySelectors = [
    ".woocommerce-product-gallery", ".product-gallery", ".product-images",
    ".woocommerce-product-gallery__wrapper", "[data-product-gallery]"
  ];
  let gallery = gallerySelectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(visible);
  if (!gallery) gallery = document.querySelector("main .product .images") ||
    document.querySelector("main .product .product-images") ||
    document.querySelector("main .product") ||
    document.querySelector("[itemtype*='Product']");
  const imageCandidates = [];
  const seen = new Set();
  if (gallery) {
    for (const img of gallery.querySelectorAll("img")) {
      if (!visible(img)) continue;
      const url = abs(img.dataset.large_image || img.dataset.src || img.dataset.lazySrc || img.currentSrc || img.src || img.getAttribute("data-lazy-src"));
      if (!url || !/^https?:/.test(url)) continue;
      const parsed = new URL(url);
      const identity = parsed.origin + parsed.pathname;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const description = [img.alt, img.className, parsed.pathname].join(" ");
      if (/logo|avatar|icon|payment|banner|sprite/i.test(description)) continue;
      if (img.naturalWidth && img.naturalWidth < 180) continue;
      if (img.closest(".related,.upsells,.cross-sells,.recommended-products,.related.products,.upsells.products")) continue;
      imageCandidates.push({url, alt:cleanText(img.alt), width:img.naturalWidth||0, height:img.naturalHeight||0});
    }
  }
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  return {
    sourceUrl: canonical, scannedAt: new Date().toISOString(), name,
    brand: cleanText(brand), sku: cleanText(sku), price: cleanText(price),
    currency: cleanText(offers?.priceCurrency || meta('meta[property="product:price:currency"]') || "PKR"),
    description, specs, images: imageCandidates
  };
}
function makeZip(entries) {
  const encoder = new TextEncoder();
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const join = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };
  const table = new Uint32Array(256);
  for (let n=0;n<256;n++) { let c=n; for(let k=0;k<8;k++) c=c&1 ? 0xedb88320^(c>>>1) : c>>>1; table[n]=c>>>0; }
  const crc32 = data => { let c=0xffffffff; for(const byte of data)c=table[(c^byte)&255]^(c>>>8); return (c^0xffffffff)>>>0; };
  const localParts=[], centralParts=[]; let offset=0;
  for (const entry of entries) {
    const name=encoder.encode(entry.name), data=entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data);
    const crc=crc32(data);
    const local=join([new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]),name,data]);
    localParts.push(local);
    const central=join([new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),name]);
    centralParts.push(central); offset+=local.length;
  }
  const central=join(centralParts);
  const end=new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(central.length),...u32(offset),...u16(0)]);
  return new Blob([...localParts,central,end],{type:"application/zip"});
}
async function scan() {
  $("scan").disabled = true; status("Scanning the current tab…");
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) throw new Error("Open a normal http/https product page first. Extensions cannot scan chrome:// pages, the Chrome Web Store, or local files.");
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractProduct});
    capture = result?.[0]?.result;
    if (!capture || typeof capture !== "object") throw new Error("The page scan returned no product data. Check chrome://extensions for an error, then reload the product tab and try again.");
    $("name").value=capture.name||""; $("brand").value=capture.brand||"";
    $("sku").value=capture.sku||""; $("price").value=capture.price||"";
    $("currency").value=capture.currency||"PKR"; $("description").value=capture.description||"";
    $("specs").value=(capture.specs||[]).map(s=>s.name+": "+s.value).join("\n");
    $("images").replaceChildren();
    (capture.images||[]).forEach((image,index)=>{
      const label=document.createElement("label"); label.className="imgcheck";
      const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=index<12; cb.dataset.index=String(index);
      const span=document.createElement("span");
      span.textContent=(index+1)+". "+(image.alt||"Image without alt text")+" — "+new URL(image.url).pathname.split("/").pop().slice(0,55);
      label.append(cb,span); $("images").append(label);
    });
    $("editor").hidden=false;
    const warnings=[];
    if(!capture.price) warnings.push("price not found");
    if(!capture.specs.length) warnings.push("no specifications found — enter them manually or a site-specific extractor is needed");
    if(!capture.images.length) warnings.push("no product-gallery images found");
    status("Found "+capture.specs.length+" spec rows and "+capture.images.length+" gallery images. "+(warnings.length ? "Review warning: "+warnings.join("; ")+".":"Review the data before saving."));
  } catch(error) { status("Scan failed: "+(error?.message||error)); }
  finally { $("scan").disabled=false; }
}
async function save() {
  if(!capture) return;
  const name=$("name").value.trim();
  if(!name) { status("Save blocked: enter a product name first."); return; }
  $("save").disabled=true; status("Downloading selected gallery images and preparing the product ZIP…");
  try {
    const product={
      name, brand:$("brand").value.trim(), sku:$("sku").value.trim(),
      price:$("price").value.trim(), currency:$("currency").value.trim()||"PKR",
      description:$("description").value.trim(), sourceUrl:capture.sourceUrl,
      capturedAt:capture.scannedAt,
      specifications:$("specs").value.split("\n").map(line=>{const i=line.indexOf(":");return i>0?{name:line.slice(0,i).trim(),value:line.slice(i+1).trim()}:null;}).filter(x=>x&&x.name&&x.value)
    };
    if(!product.price || !product.specifications.length) {
      const proceed=confirm("Price or specifications are empty. Save this product anyway? The missing data will be recorded, not silently treated as complete.");
      if(!proceed) return;
    }
    const chosen=[...$("images").querySelectorAll("input:checked")].map(cb=>capture.images[Number(cb.dataset.index)]).filter(Boolean);
    const folder=safeName(product.sku||product.name);
    const entries=[], failures=[];
    for(let i=0;i<chosen.length;i++){
      const image=chosen[i];
      try {
        const response=await fetch(image.url,{credentials:"omit"});
        if(!response.ok) throw new Error("HTTP "+response.status);
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(bytes.length<100) throw new Error("response too small");
        const path=new URL(image.url).pathname;
        let ext=(path.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
        if(!["jpg","jpeg","png","webp","gif","avif"].includes(ext)) ext="jpg";
        if(ext==="jpeg")ext="jpg";
        entries.push({name:folder+"/images/image-"+String(entries.length+1).padStart(2,"0")+"."+ext,data:bytes});
      } catch(error) { failures.push({url:image.url,error:String(error?.message||error)}); }
    }
    product.images=entries.map(e=>e.name);
    product.imageDownloadFailures=failures;
    const specText=product.specifications.map(s=>s.name+": "+s.value).join("\n")||"(No specifications captured. Manual review required.)";
    const readable=product.name+"\n"+"=".repeat(product.name.length)+"\nSource: "+product.sourceUrl+"\nBrand: "+product.brand+"\nSKU / Model: "+product.sku+"\nPrice: "+product.price+" "+product.currency+"\n\nDescription\n"+product.description+"\n\nSpecifications\n"+specText+"\n\nImages saved: "+entries.length+"\nImage download failures: "+failures.length+"\n";
    entries.unshift(
      {name:folder+"/product.json",data:JSON.stringify(product,null,2)},
      {name:folder+"/product.txt",data:readable},
      {name:folder+"/capture-log.json",data:JSON.stringify({sourceUrl:product.sourceUrl,capturedAt:product.capturedAt,selectedImages:chosen.length,savedImages:product.images.length,failures,missingFields:[...(!product.price?["price"]:[]),...(!product.specifications.length?["specifications"]:[])]},null,2)}
    );
    const url=URL.createObjectURL(makeZip(entries));
    await chrome.downloads.download({url,filename:"Techistics-Manual-Captures/"+folder+".zip",saveAs:true});
    status("ZIP created: "+folder+".zip\nSpecifications: "+product.specifications.length+"\nImages saved: "+product.images.length+"/"+chosen.length+"\nImage download failures: "+failures.length+"\n\nOpen product.json and product.txt to review before using the data.");
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } catch(error) { status("Save failed: "+(error?.message||error)); }
  finally { $("save").disabled=false; }
}
$("scan").addEventListener("click",scan);
$("rescan").addEventListener("click",scan);
$("save").addEventListener("click",save);
