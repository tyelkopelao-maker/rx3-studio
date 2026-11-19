(()=>{
'use strict';
const $=id=>document.getElementById(id);
const TYPE_TEXTURE=0x7a0b60da, TYPE_BATCH=0x6bd085dc, TYPE_NAMES=0x4c9b9eb2;
const EXPECTED=['crest_cm','jersey_cm','jersey_coeff','shorts_cm','shorts_coeff'];
let loaded=null, parsed=null, replacements={};
const fmtBytes=n=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(2)} MB`;
function setStatus(msg,kind=''){ $('status').textContent=msg; $('status').className='status '+kind; }
function align16(n){return (n+15)&~15;}
function readU32(v,o,little){return v.getUint32(o,little)}
function writeU32(v,o,n,little){v.setUint32(o,n>>>0,little)}
function readU16(v,o,little){return v.getUint16(o,little)}
function parseRx3(buffer){
 const bytes=new Uint8Array(buffer), view=new DataView(buffer);
 if(bytes.length<16)throw Error('El archivo es demasiado pequeño.');
 if(String.fromCharCode(...bytes.slice(0,3))!=='RX3')throw Error('No se encontró la firma RX3.');
 const endian=String.fromCharCode(bytes[3]); if(endian!=='l'&&endian!=='b')throw Error('Marca de endianess no reconocida.');
 const little=endian==='l',version=readU32(view,4,little),declared=readU32(view,8,little),count=readU32(view,12,little);
 if(count<1||count>4096||16+count*16>bytes.length)throw Error('La tabla de chunks no es válida.');
 const chunks=[];
 for(let i=0;i<count;i++){const p=16+i*16,type=readU32(view,p,little),offset=readU32(view,p+4,little),size=readU32(view,p+8,little),padding=readU32(view,p+12,little);if(offset>bytes.length||size>bytes.length-offset)throw Error(`El chunk ${i+1} apunta fuera del archivo.`);chunks.push({index:i,type,offset,size,padding,typeId:type,raw:bytes.slice(offset,offset+size)});}
 const batch=chunks.find(c=>c.typeId===TYPE_BATCH), nameChunk=chunks.find(c=>c.typeId===TYPE_NAMES), textureChunks=chunks.filter(c=>c.typeId===TYPE_TEXTURE);
 if(!batch||!nameChunk||textureChunks.length!==5)throw Error('Este RX3 no contiene la estructura de kit esperada (TEXTURE_BATCH, NAME_TABLE y cinco TEXTURE).');
 const bview=new DataView(batch.raw.buffer,batch.raw.byteOffset,batch.raw.byteLength),batchCount=readU32(bview,0,little);
 if(batchCount!==5||batch.raw.length<16+batchCount*16)throw Error('La tabla TEXTURE_BATCH no contiene cinco entradas válidas.');
 const nview=new DataView(nameChunk.raw.buffer,nameChunk.raw.byteOffset,nameChunk.raw.byteLength),nameCount=readU32(nview,4,little);if(nameCount!==5)throw Error('La tabla NAME_TABLE no contiene cinco nombres.');
 let cur=16,names=[];
 for(let i=0;i<nameCount;i++){if(cur+8>nameChunk.raw.length)throw Error('NAME_TABLE truncada.');const len=readU32(nview,cur+4,little);cur+=8;if(len<1||cur+len>nameChunk.raw.length)throw Error('Longitud de nombre inválida en NAME_TABLE.');let raw=nameChunk.raw.slice(cur,cur+len);let end=raw.indexOf(0);if(end>=0)raw=raw.slice(0,end);names.push(new TextDecoder().decode(raw));cur+=len;}
 const textures=[];
 for(let i=0;i<5;i++){
  const chunk=textureChunks[i],raw=chunk.raw, tv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  if(raw.length<32)throw Error(`La textura ${i+1} es demasiado pequeña.`);
  const id=readU32(tv,0,little),flags=readU32(tv,4,little),width=readU16(tv,8,little),height=readU16(tv,10,little),mipPack=readU32(tv,12,little),mipCount=mipPack>>>16;
  if(!width||!height||mipCount<1||mipCount>16)throw Error(`Dimensiones o mipmaps inválidos en ${names[i]||i+1}.`);
  let format=flags===0x00010301?'RGBA32':flags===0x00010001?'DXT1':flags===0x00010201?'DXT5':null;
  if(!format)throw Error(`Formato de textura no compatible en ${names[i]} (0x${flags.toString(16)}).`);
  let p=16,mips=[];
  for(let m=0;m<mipCount;m++){
   if(p+16>raw.length)throw Error(`Cabecera de mipmap incompleta en ${names[i]}.`);
   const mv=new DataView(raw.buffer,raw.byteOffset+p,16),rowPitch=readU32(mv,0,little),rows=readU32(mv,4,little),dataSize=readU32(mv,8,little);p+=16;
   if(dataSize>raw.length-p)throw Error(`Datos de mipmap fuera del bloque en ${names[i]}.`);
   const mw=Math.max(1,width>>m),mh=Math.max(1,height>>m),blocksX=Math.max(1,Math.ceil(mw/4)),blocksY=Math.max(1,Math.ceil(mh/4));
   const expected=format==='RGBA32'?mw*mh*4:blocksX*blocksY*(format==='DXT1'?8:16);
   if(dataSize!==expected)throw Error(`Tamaño de mipmap inesperado en ${names[i]} nivel ${m+1}. El formato requiere revisión.`);
   mips.push({width:mw,height:mh,rowPitch,rows,dataSize,data:raw.slice(p,p+dataSize)});p+=dataSize;
  }
  const tail=raw.slice(p); if(tail.length>32)throw Error(`Datos adicionales no reconocidos en ${names[i]}.`);
  const batchId=readU32(bview,16+i*16,little);if(batchId!==id)throw Error(`El orden de TEXTURE_BATCH no coincide con ${names[i]}.`);
  const texture={name:names[i],chunk,raw,id,flags,width,height,mipCount,format,mips,tail,preview:null};
  texture.preview=decodeTopMip(texture);textures.push(texture);
 }
 const missing=EXPECTED.filter(n=>!names.includes(n));if(missing.length)throw Error('Faltan nombres de textura esperados: '+missing.join(', '));
 const maxEnd=Math.max(...chunks.map(c=>c.offset+c.size));
 return {buffer,bytes,little,version,declared,count,chunks,batch,nameChunk,textures,maxEnd,trailer:bytes.slice(maxEnd)};
}
function rgb565(c){return [((c>>11)&31)*255/31,((c>>5)&63)*255/63,(c&31)*255/31,255];}
function colorPalette(c0,c1,dxt1){const a=rgb565(c0),b=rgb565(c1),p=[a,b];if(c0>c1||!dxt1){p.push([(2*a[0]+b[0])/3,(2*a[1]+b[1])/3,(2*a[2]+b[2])/3,255]);p.push([(a[0]+2*b[0])/3,(a[1]+2*b[1])/3,(a[2]+2*b[2])/3,255]);}else{p.push([(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,255]);p.push([0,0,0,0]);}return p;}
function decodeColorBlock(data,o,dxt1=true){const c0=data[o]|data[o+1]<<8,c1=data[o+2]|data[o+3]<<8,pal=colorPalette(c0,c1,dxt1),bits=(data[o+4]|data[o+5]<<8|data[o+6]<<16|data[o+7]<<24)>>>0,out=[];for(let i=0;i<16;i++)out.push(pal[(bits>>>(2*i))&3]);return out;}
function decodeDxtBlock(data,o,format){let colors,alphas=null;if(format==='DXT1')colors=decodeColorBlock(data,o,true);else{const a0=data[o],a1=data[o+1],pal=[a0,a1];if(a0>a1){for(let i=1;i<=6;i++)pal.push(((7-i)*a0+i*a1)/7);}else{for(let i=1;i<=4;i++)pal.push(((5-i)*a0+i*a1)/5);pal.push(0,255);}let bits=0n;for(let i=0;i<6;i++)bits|=BigInt(data[o+2+i])<<BigInt(8*i);alphas=[];for(let i=0;i<16;i++)alphas.push(pal[Number((bits>>BigInt(3*i))&7n)]);colors=decodeColorBlock(data,o+8,false);}return colors.map((c,i)=>[c[0],c[1],c[2],alphas?alphas[i]:c[3]]);}
function decodeTopMip(tex){const mip=tex.mips[0],canvas=document.createElement('canvas');canvas.width=tex.width;canvas.height=tex.height;const ctx=canvas.getContext('2d'),im=ctx.createImageData(tex.width,tex.height),dst=im.data;
 if(tex.format==='RGBA32')dst.set(mip.data);
 else{const blocksX=Math.max(1,Math.ceil(tex.width/4)),blocksY=Math.max(1,Math.ceil(tex.height/4)),blockBytes=tex.format==='DXT1'?8:16;for(let by=0;by<blocksY;by++)for(let bx=0;bx<blocksX;bx++){const px=decodeDxtBlock(mip.data,(by*blocksX+bx)*blockBytes,tex.format);for(let y=0;y<4;y++)for(let x=0;x<4;x++){const xx=bx*4+x,yy=by*4+y;if(xx>=tex.width||yy>=tex.height)continue;const c=px[y*4+x],d=(yy*tex.width+xx)*4;dst[d]=c[0];dst[d+1]=c[1];dst[d+2]=c[2];dst[d+3]=c[3];}}}
 ctx.putImageData(im,0,0);return canvas;}
function pack565(r,g,b){return ((Math.round(r*31/255)<<11)|(Math.round(g*63/255)<<5)|Math.round(b*31/255))&65535;}
function unpack565(v){return [((v>>11)&31)*255/31,((v>>5)&63)*255/63,(v&31)*255/31];}
function colorDist(a,b){const dr=a[0]-b[0],dg=a[1]-b[1],db=a[2]-b[2];return dr*dr*0.9+dg*dg*1.5+db*db*0.6;}
function makePalette(c0,c1,transparent){const a=unpack565(c0),b=unpack565(c1);if(transparent)return [a,b,[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],[0,0,0]];return [a,b,[(2*a[0]+b[0])/3,(2*a[1]+b[1])/3,(2*a[2]+b[2])/3],[(a[0]+2*b[0])/3,(a[1]+2*b[1])/3,(a[2]+2*b[2])/3]];}
function encodeColorBlock(pixels,allowAlpha){let opaque=pixels.filter(p=>!allowAlpha||p[3]>=128);if(!opaque.length)opaque=[[0,0,0,255]];let lo=opaque[0],hi=opaque[0],lmin=1e20,lmax=-1e20;for(const p of opaque){const l=p[0]*0.299+p[1]*0.587+p[2]*0.114;if(l<lmin){lmin=l;lo=p;}if(l>lmax){lmax=l;hi=p;}}
 let c0=pack565(hi[0],hi[1],hi[2]),c1=pack565(lo[0],lo[1],lo[2]),hasAlpha=allowAlpha&&pixels.some(p=>p[3]<128);
 if(hasAlpha){if(c0>c1){const t=c0;c0=c1;c1=t;}if(c0===c1&&c1<65535)c1++;}
 else{if(c0<c1){const t=c0;c0=c1;c1=t;}if(c0===c1){if(c0<65535)c0++;else c1--;}}
 const pal=makePalette(c0,c1,hasAlpha);let inds=0;for(let i=0;i<16;i++){const p=pixels[i];let best=0;if(hasAlpha&&p[3]<128)best=3;else{let bd=Infinity,lim=hasAlpha?3:4;for(let j=0;j<lim;j++){const d=colorDist(p,pal[j]);if(d<bd){bd=d;best=j;}}}inds|=(best&3)<<(2*i);}
 return [c0&255,c0>>8,c1&255,c1>>8,inds&255,(inds>>>8)&255,(inds>>>16)&255,(inds>>>24)&255];}
function encodeDxt1Block(pix){return encodeColorBlock(pix,true);}
function encodeDxt5Block(pix){let amin=255,amax=0;for(const p of pix){amin=Math.min(amin,p[3]);amax=Math.max(amax,p[3]);}let a0=amax,a1=amin;if(a0<=a1){if(a0<255)a0=a1+1;else a1=a0-1;}const ap=[a0,a1];for(let i=1;i<=6;i++)ap.push(((7-i)*a0+i*a1)/7);let alphaBits=0n;for(let i=0;i<16;i++){let best=0,bd=Infinity;for(let j=0;j<8;j++){const d=(pix[i][3]-ap[j])**2;if(d<bd){bd=d;best=j;}}alphaBits|=BigInt(best)<<BigInt(3*i);}const c=encodeColorBlock(pix,false),out=[a0,a1];for(let i=0;i<6;i++)out.push(Number((alphaBits>>BigInt(8*i))&255n));return out.concat(c);}
function encodeMip(imageData,w,h,format){const data=imageData.data;if(format==='RGBA32')return new Uint8Array(data);const bx=Math.max(1,Math.ceil(w/4)),by=Math.max(1,Math.ceil(h/4)),bb=format==='DXT1'?8:16,out=new Uint8Array(bx*by*bb);for(let yb=0;yb<by;yb++)for(let xb=0;xb<bx;xb++){const pix=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++){const x0=Math.min(w-1,xb*4+x),y0=Math.min(h-1,yb*4+y),p=(y0*w+x0)*4;pix.push([data[p],data[p+1],data[p+2],data[p+3]]);}const block=format==='DXT1'?encodeDxt1Block(pix):encodeDxt5Block(pix),off=(yb*bx+xb)*bb;out.set(block,off);}return out;}
function targetDimensions(w,h){return {w,h};}
function canvasFromSource(source,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{alpha:true});ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const sw=source.width,sh=source.height,scale=Math.min(w/sw,h/sh),dw=sw*scale,dh=sh*scale;ctx.drawImage(source,(w-dw)/2,(h-dh)/2,dw,dh);return c;}
function makeMipChain(base,format,maxLevels=16){const levels=[];let c=base;while(levels.length<maxLevels){const w=c.width,h=c.height,ctx=c.getContext('2d'),im=ctx.getImageData(0,0,w,h),encoded=encodeMip(im,w,h,format);const blocksY=format==='RGBA32'?h:Math.max(1,Math.ceil(h/4)),rowPitch=format==='RGBA32'?w*4:Math.max(1,Math.ceil(w/4))*(format==='DXT1'?8:16);levels.push({w,h,rows:blocksY,rowPitch,data:encoded});if(w===1&&h===1)break;const nw=Math.max(1,w>>1),nh=Math.max(1,h>>1),next=document.createElement('canvas');next.width=nw;next.height=nh;const nctx=next.getContext('2d');nctx.imageSmoothingEnabled=true;nctx.imageSmoothingQuality='high';nctx.drawImage(c,0,0,nw,nh);c=next;}return levels;}
function concatParts(parts){let total=0;for(const p of parts)total+=p.length;const out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
function makeTextureChunk(tex,base,little){const levels=makeMipChain(base,tex.format,tex.mipCount),head=tex.raw.slice(0,16),hv=new DataView(head.buffer,head.byteOffset,head.byteLength);hv.setUint16(8,base.width,little);hv.setUint16(10,base.height,little);hv.setUint32(12,((levels.length<<16)|1)>>>0,little);const parts=[head];for(const lv of levels){const mh=new Uint8Array(16),v=new DataView(mh.buffer);v.setUint32(0,lv.rowPitch,little);v.setUint32(4,lv.rows,little);v.setUint32(8,lv.data.length,little);v.setUint32(12,0,little);parts.push(mh,lv.data);}parts.push(tex.tail);return concatParts(parts);}
function rebuildRx3(state,newTextureChunks){const chunks=state.chunks.map(c=>({type:c.typeId,padding:c.padding,raw:c.raw.slice()}));let textureIndex=0;for(let i=0;i<chunks.length;i++)if(chunks[i].type===TYPE_TEXTURE)chunks[i].raw=newTextureChunks[textureIndex++];
 const batch=chunks.find(c=>c.type===TYPE_BATCH);if(!batch)throw Error('No se encontró TEXTURE_BATCH al reconstruir.');for(let i=0;i<5;i++)batch.raw.set(newTextureChunks[i].slice(0,16),16+i*16);
 const headerSize=16+chunks.length*16;let cursor=headerSize;const offsets=[];for(const c of chunks){cursor=align16(cursor);offsets.push(cursor);cursor+=c.raw.length;}
 const trailer=state.trailer||new Uint8Array(0),out=new Uint8Array(cursor+trailer.length),view=new DataView(out.buffer);out.set([82,88,51,state.little?108:98],0);writeU32(view,4,state.version,state.little);writeU32(view,8,cursor,state.little);writeU32(view,12,chunks.length,state.little);
 for(let i=0;i<chunks.length;i++){const p=16+i*16,c=chunks[i];writeU32(view,p,c.type,state.little);writeU32(view,p+4,offsets[i],state.little);writeU32(view,p+8,c.raw.length,state.little);writeU32(view,p+12,c.padding,state.little);out.set(c.raw,offsets[i]);}out.set(trailer,cursor);return out.buffer;}
function canvasPreview(canvas){return canvas.toDataURL('image/png');}
function renderTextures(){const grid=$('textureGrid');grid.innerHTML='';for(const tex of parsed.textures){const card=document.createElement('article');card.className='texture-card';const title=document.createElement('div');title.className='texture-title';title.textContent=tex.name;const dims=targetDimensions(tex.width,tex.height);const meta=document.createElement('div');meta.className='texture-meta';meta.textContent=`Original ${tex.width}×${tex.height} · salida ${dims.w}×${dims.h}`;const preview=document.createElement('div');preview.className='preview';const cv=document.createElement('canvas');const src=replacements[tex.name]?.canvas||tex.preview;cv.width=src.width;cv.height=src.height;cv.getContext('2d').drawImage(src,0,0);preview.append(cv);const bottom=document.createElement('div');bottom.className='texture-bottom';const tag=document.createElement('span');tag.className='format-tag';tag.textContent=tex.format;const label=document.createElement('label');label.className='replace-label'+(replacements[tex.name]?' replaced':'');label.textContent=replacements[tex.name]?'✓ PNG reemplazado':'＋ Reemplazar PNG';const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.addEventListener('change',()=>loadReplacement(tex,input.files[0]));label.append(input);bottom.append(tag,label);card.append(title,meta,preview,bottom);grid.append(card);}}
async function loadReplacement(tex,file){if(!file)return;try{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{const d=targetDimensions(tex.width,tex.height),c=canvasFromSource(img,d.w,d.h);replacements[tex.name]={canvas:c,fileName:file.name};URL.revokeObjectURL(url);renderTextures();setStatus(`${tex.name}: imagen preparada en ${d.w}×${d.h}.`, 'good');};img.onerror=()=>{URL.revokeObjectURL(url);setStatus('No se pudo abrir la imagen seleccionada.','warn');};img.src=url;}catch(e){setStatus(e.message,'warn');}}
async function handleFile(file){if(!file)return;loaded=file;parsed=null;replacements={};$('fileName').textContent=file.name;$('fileSize').textContent=fmtBytes(file.size);$('fileRow').classList.remove('hidden');$('dropzone').classList.add('hidden');$('editor').classList.add('hidden');$('emptyHelp').classList.add('hidden');$('exportBtn').disabled=true;setStatus('Leyendo estructura RX3…');try{const buf=await file.arrayBuffer();parsed=parseRx3(buf);renderTextures();$('editor').classList.remove('hidden');$('exportBtn').disabled=false;$('exportHint').textContent='Se conservarán las dimensiones y cantidad de mipmaps originales de cada textura.';setStatus(`RX3 reconocido · ${parsed.textures.length} texturas vinculadas correctamente · ${fmtBytes(file.size)}.`, 'good');}catch(e){setStatus(e.message,'warn');$('editor').classList.add('hidden');$('emptyHelp').classList.remove('hidden');}}
async function exportRx3(){if(!parsed)return;const btn=$('exportBtn');btn.disabled=true;btn.textContent='Procesando texturas…';setStatus('Generando imágenes y mipmaps. No cierres esta pestaña…');try{const newChunks=[];for(let i=0;i<parsed.textures.length;i++){const tex=parsed.textures[i],d=targetDimensions(tex.width,tex.height),source=replacements[tex.name]?.canvas||tex.preview,base=canvasFromSource(source,d.w,d.h);newChunks.push(makeTextureChunk(tex,base,parsed.little));setStatus(`Procesando ${tex.name} (${i+1}/5)…`);}const output=rebuildRx3(parsed,newChunks);setStatus('Validando el RX3 reconstruido…');const check=parseRx3(output);if(check.textures.length!==5||check.textures.some(t=>!t.mips.length))throw Error('La validación posterior a la reconstrucción falló.');const blob=new Blob([output],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=loaded.name.replace(/\.rx3$/i,'')+'_1024.rx3';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);setStatus(`RX3 reconstruido y validado · ${fmtBytes(output.byteLength)}. Probalo primero en una copia del juego.`, 'good');}catch(e){console.error(e);setStatus(`No se pudo exportar: ${e.message}`,'warn');}finally{btn.disabled=false;btn.innerHTML='<span>↓</span> Reconstruir y descargar RX3';}}
function clearAll(){loaded=null;parsed=null;replacements={};$('fileInput').value='';$('fileRow').classList.add('hidden');$('dropzone').classList.remove('hidden');$('editor').classList.add('hidden');$('emptyHelp').classList.remove('hidden');$('exportBtn').disabled=true;setStatus('Esperando un archivo RX3…');}
$('fileInput').addEventListener('change',e=>handleFile(e.target.files[0]));$('clearBtn').addEventListener('click',clearAll);$('exportBtn').addEventListener('click',exportRx3);$('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('drag');});$('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('drag'));$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');handleFile(e.dataTransfer.files[0]);});$('helpBtn').addEventListener('click',()=>$('helpModal').classList.remove('hidden'));$('closeHelp').addEventListener('click',()=>$('helpModal').classList.add('hidden'));$('helpModal').addEventListener('click',e=>{if(e.target===$('helpModal'))$('helpModal').classList.add('hidden');});
window.RX3StudioDebug={parseRx3,decodeTopMip,makeTextureChunk,rebuildRx3,targetDimensions,makeMipChain};
})();
