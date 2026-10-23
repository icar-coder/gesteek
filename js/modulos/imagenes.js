(() => {
  const { el, vaciar } = Gestor.dom;
  const almacen = Gestor.almacen;
  const blobs = Gestor.blobstore;

  const ID = 'imagenes';
  const TIPOS_OK = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
  const TAM_PAGINA = 60;

  /* ---------- Estado ---------- */
  let imagenes = {};
  let carpetasVirtuales = [];
  const filtro = { texto:'', carpeta:'todas', tag:'', orden:'reciente', faltantes:false };
  let refs = {};
  let urlCache = new Map();
  let io = null;
  let ioMas = null;
  let masonry = null;
  let masonryPendiente = null;
  let generacion = 0;
  let pagina = 0;
  let listaActual = [];
  let sentinel = null;
  let ro = null;
  let detalleId = null;
  let detalleUrl = null;       // FIX: objectURL del preview (para revocar)
  let procesando = false;      // FIX: evita solapar indexados

  /* ---------- Persistencia ---------- */
  function cargar(){
    const data = almacen.leer(ID, null);
    if(data && typeof data === 'object'){
      imagenes = data.imagenes || {};
      carpetasVirtuales = data.carpetasVirtuales || [];
    }
  }
  function guardar(){
    almacen.escribir(ID, { imagenes, carpetasVirtuales });
  }

  /* ---------- Helpers ---------- */
  function hash(str){
    let h = 0;
    for(let i=0;i<str.length;i++){ h = ((h<<5)-h) + str.charCodeAt(i); h |= 0; }
    return 'img_' + Math.abs(h).toString(36);
  }

  function medirImagen(file){
    return new Promise(res => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload  = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
      im.onerror = () => { res({ w: 0, h: 0 }); URL.revokeObjectURL(url); };
      im.src = url;
    });
  }

  function columnWidthActual(){
    let ancho = 0;
    try{ ancho = Math.round(refs.galeria.getBoundingClientRect().width); }catch(e){}
    if(!ancho || ancho < 100){
      ancho = Math.max(600, (window.innerWidth || 1200) - 40);
    }
    const gap = 8;
    let bestCols = 1, bestDiff = Infinity;
    for(let c = 1; c <= 10; c++){
      const w = (ancho - gap * (c - 1)) / c;
      if(w < 140 || w > 260) continue;
      const diff = Math.abs(w - 190);
      if(diff < bestDiff){ bestDiff = diff; bestCols = c; }
    }
    return Math.floor((ancho - gap * (bestCols - 1)) / bestCols);
  }

  /* ---------- Selección de carpeta ---------- */
  function seleccionarCarpeta(){
    refs.fileInput.click();
  }

  async function procesarArchivos(files){
    if(procesando) return;            // FIX: ignora doble disparo
    procesando = true;
    const gen = generacion;

    try {
      const total = files.length;
      let procesadas = 0;
      const vistos = new Set();
      const lista = [...files].filter(f => TIPOS_OK.test(f.name));

      for(const f of lista){
        if(gen !== generacion) break; // FIX: aborta si se repintó/desmontó

        const path = f.webkitRelativePath || f.name;
        const id = hash(path);
        vistos.add(id);

        const prev = imagenes[id];
        const cambio = !prev || prev.size !== f.size || prev.mtime !== f.lastModified;

        const partes = path.split('/');
        const diskFolder = partes.length > 2 ? partes.slice(1, -1).join('/') : '';

        let w = prev?.w || 0, h = prev?.h || 0;
        if(cambio || !w || !h){
          const dim = await medirImagen(f);
          w = dim.w; h = dim.h;
        }

        imagenes[id] = {
          id,
          diskPath: path,
          nombre: f.name,
          diskFolder,
          size: f.size,
          mtime: f.lastModified,
          w, h,
          notas: prev?.notas || '',
          tags: prev?.tags || [],
          carpetas: prev?.carpetas || [],
          enlaces: prev?.enlaces || [],
          creada: prev?.creada || Date.now(),
          faltante: false
        };

        if(cambio){
          await blobs.guardar(id, f);
        }

        procesadas++;
        if(refs.progreso && (procesadas % 10 === 0 || procesadas === total)){
          refs.progreso.textContent = `Indexando… ${procesadas}/${total}`;
        }
      }

      if(gen !== generacion) return;

      for(const id in imagenes){
        if(!vistos.has(id)) imagenes[id].faltante = true;
      }

      guardar();
      if(refs.progreso) refs.progreso.textContent = '';
      pintar();
    } finally {
      procesando = false;
    }
  }

  /* ---------- Filtro/orden ---------- */
  function visibles(){
    const t = filtro.texto.trim().toLowerCase();
    const arr = Object.values(imagenes).filter(img => {
      if(!filtro.faltantes && img.faltante) return false;
      if(filtro.carpeta !== 'todas'){
        if(filtro.carpeta === '__sin__'){ if(img.carpetas.length) return false; }
        else if(!img.carpetas.includes(filtro.carpeta)) return false;
      }
      if(filtro.tag && !img.tags.includes(filtro.tag)) return false;
      if(t){
        const blob = `${img.nombre} ${img.notas} ${img.tags.join(' ')} ${img.carpetas.join(' ')} ${img.diskFolder}`.toLowerCase();
        if(!blob.includes(t)) return false;
      }
      return true;
    });

    arr.sort((a,b) => {
      if(filtro.orden === 'nombre')  return a.nombre.localeCompare(b.nombre,'es');
      if(filtro.orden === 'carpeta') return (a.diskFolder||'').localeCompare(b.diskFolder||'','es');
      if(filtro.orden === 'tamano')  return (b.size||0) - (a.size||0);
      return (b.creada||0) - (a.creada||0);
    });
    return arr;
  }

  function todosTags(){
    const s = new Set();
    Object.values(imagenes).forEach(i => i.tags.forEach(t => s.add(t)));
    return [...s].sort((a,b)=>a.localeCompare(b,'es'));
  }

  /* ---------- Render ---------- */
  function pintar(){
    generacion++;
    if(masonryPendiente){
      cancelAnimationFrame(masonryPendiente);
      masonryPendiente = null;
    }

    const { galeria, stats, selCarpeta, selTag, contador } = refs;
    if(!galeria) return;

    vaciar(selCarpeta);
    selCarpeta.append(el('option',{value:'todas',texto:'Todas las carpetas'}));
    selCarpeta.append(el('option',{value:'__sin__',texto:'— Sin carpeta —'}));
    carpetasVirtuales.slice().sort((a,b)=>a.localeCompare(b,'es'))
      .forEach(c => selCarpeta.append(el('option',{value:c,texto:c})));
    selCarpeta.value = filtro.carpeta;

    vaciar(selTag);
    selTag.append(el('option',{value:'',texto:'Todas las etiquetas'}));
    todosTags().forEach(t => selTag.append(el('option',{value:t,texto:'#'+t})));
    selTag.value = filtro.tag;

    const total = Object.keys(imagenes).length;
    const faltantes = Object.values(imagenes).filter(i=>i.faltante).length;
    vaciar(stats);
    stats.append(el('span',{texto:`${total} imágenes`}));
    stats.append(el('span',{texto:`${carpetasVirtuales.length} carpetas`}));
    stats.append(el('span',{texto:`${todosTags().length} etiquetas`}));
    if(faltantes) stats.append(el('span',{style:'color:#e5484d;font-weight:600',texto:`⚠️ ${faltantes} faltantes`}));

    if(masonry){ masonry.destroy(); masonry = null; }
    if(ioMas){ ioMas.disconnect(); ioMas = null; }
    if(io){ io.disconnect(); io = null; }

    galeria.querySelectorAll('.card, .vacio').forEach(n => n.remove());
    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();

    listaActual = visibles();
    pagina = 0;
    contador.textContent = `0 de ${listaActual.length}`;

    if(sentinel) sentinel.classList.remove('fin');

    if(!listaActual.length){
      galeria.classList.remove('galeria--masonry','galeria--cols');
      galeria.append(el('div',{class:'vacio', style:'width:100%',
        texto: total ? '🔍 Nada coincide con el filtro' : '📂 Pulsa "Seleccionar carpeta" para empezar'
      }));
      if(sentinel) sentinel.classList.add('oculto');
      return;
    }

    if(sentinel) sentinel.classList.remove('oculto');

    const usarMasonry = !!window.Masonry && !window.__sinMasonry;
    galeria.classList.toggle('galeria--masonry', usarMasonry);
    galeria.classList.toggle('galeria--cols', !usarMasonry);
    galeria.style.setProperty('--col-width', columnWidthActual() + 'px');

    io = new IntersectionObserver(onIntersect, { rootMargin: '400px 0px' });
    cargarMas(usarMasonry);

    if(sentinel){
      ioMas = new IntersectionObserver((entries) => {
        if(entries[0].isIntersecting) cargarMas(usarMasonry);
      }, { rootMargin: '600px 0px' });
      ioMas.observe(sentinel);
    }
  }

  function cargarMas(usarMasonry){
    if(!listaActual.length) return;

    const inicio = pagina * TAM_PAGINA;
    const fin = inicio + TAM_PAGINA;
    const trozo = listaActual.slice(inicio, fin);

    if(!trozo.length){
      sentinel && sentinel.classList.add('fin');
      ioMas && ioMas.disconnect();
      return;
    }
    pagina++;

    const nodos = trozo.map(img => tarjeta(img));
    nodos.forEach(n => refs.galeria.append(n));

    if(usarMasonry){
      if(masonry){
        masonry.appended(nodos);
      } else if(!masonryPendiente){
        const gen = generacion;
        masonryPendiente = requestAnimationFrame(() => {
          masonryPendiente = null;
          if(gen !== generacion) return;
          if(!refs.galeria || !refs.galeria.isConnected) return;
          if(masonry) return;

          masonry = new window.Masonry(refs.galeria, {
            itemSelector: '.card',
            columnWidth: columnWidthActual(),
            gutter: 8,
            horizontalOrder: true,
            transitionDuration: '0.2s'
          });
        });
      }
    }

    if(io) nodos.forEach(n => io.observe(n));

    const mostradas = Math.min(fin, listaActual.length);
    refs.contador.textContent = `${mostradas} de ${listaActual.length}`;

    if(fin >= listaActual.length){
      sentinel && sentinel.classList.add('fin');
      ioMas && ioMas.disconnect();
    }
  }

  function tarjeta(img){
    const card = el('article',{class:'card', dataset:{id:img.id}});
    if(img.faltante) card.classList.add('faltante');

    let ratio = (img.w && img.h) ? (img.w / img.h) : 1;
    ratio = Math.max(0.5, Math.min(ratio, 2.5));

    const media = el('div',{class:'card__media'});
    media.style.setProperty('--ratio', ratio);

    const imgEl = el('img',{alt:img.nombre, loading:'lazy'});
    imgEl.dataset.id = img.id;
    imgEl.addEventListener('click', () => abrirDetalle(img.id));

    media.append(imgEl);
    card.append(media);

    const pie = el('div',{class:'card__pie'});
    pie.append(el('div',{class:'card__nombre',texto:img.nombre}));

    const meta = el('div',{class:'card__meta'});
    if(img.tags.length)      meta.append(el('span',{texto:'#'+img.tags[0]+(img.tags.length>1?` +${img.tags.length-1}`:'')}));
    if(img.carpetas.length)  meta.append(el('span',{texto:'📁 '+img.carpetas[0]+(img.carpetas.length>1?` +${img.carpetas.length-1}`:'')}));
    if(img.enlaces.length)   meta.append(el('span',{texto:'🔗 '+img.enlaces.length}));
    if(meta.children.length) pie.append(meta);

    card.append(pie);

    if(img.notas){
      card.append(el('div',{class:'card__notas', texto:img.notas}));
    }

    return card;
  }

  async function onIntersect(entries){
    for(const e of entries){
      const card = e.target;
      const id = card.dataset.id;
      const imgEl = card.querySelector('img');
      if(!imgEl) continue;

      if(e.isIntersecting){
        if(imgEl.dataset.cargado) continue;
        try{
          const blob = await blobs.leer(id);
          if(!blob) continue;
          const prevUrl = urlCache.get(id);
          if(prevUrl) URL.revokeObjectURL(prevUrl);   // FIX: defensa
          const url = URL.createObjectURL(blob);
          urlCache.set(id, url);
          imgEl.src = url;
          imgEl.dataset.cargado = '1';
        }catch(err){ console.warn('blob', id, err); }

      } else {
        if(!imgEl.dataset.cargado) continue;
        const r = card.getBoundingClientRect();
        const lejos = r.bottom < -1000 || r.top > window.innerHeight + 1000;
        if(!lejos) continue;

        const url = urlCache.get(id);
        if(url) URL.revokeObjectURL(url);
        urlCache.delete(id);
        imgEl.removeAttribute('src');
        delete imgEl.dataset.cargado;
      }
    }
  }

  /* ---------- Detalle ---------- */
  function liberarPreview(){
    // FIX: revoca el objectURL de la vista previa del detalle
    if(detalleUrl){ URL.revokeObjectURL(detalleUrl); detalleUrl = null; }
  }

  function abrirDetalle(id){
    const img = imagenes[id]; if(!img) return;
    liberarPreview();              // FIX: cierra fuga anterior
    detalleId = id;
    const d = refs.detalle;

    d.querySelector('[data-campo="nombre"]').textContent = img.nombre;
    d.querySelector('[data-campo="path"]').textContent = img.diskPath;
    d.querySelector('[data-campo="notas"]').value = img.notas || '';
    d.querySelector('[data-campo="tags"]').value = img.tags.join(', ');
    d.querySelector('[data-campo="carpetas"]').value = img.carpetas.join(', ');

    const cont = d.querySelector('[data-campo="preview"]');
    vaciar(cont);
    const prev = el('img',{alt:img.nombre});
    const miId = id;
    blobs.leer(id).then(blob => {
      // FIX: no pintar si ya se abrió otra / se cerró
      if(!blob || detalleId !== miId) return;
      liberarPreview();
      detalleUrl = URL.createObjectURL(blob);
      prev.src = detalleUrl;
    });
    cont.append(prev);

    pintarEnlaces(img);
    pintarSugerencias(img);

    d.showModal();
  }

  function cerrarDetalle(){
    liberarPreview();
    detalleId = null;
    try{ refs.detalle?.close(); }catch(e){}
  }

  function pintarEnlaces(img){
    const cont = refs.detalle.querySelector('[data-campo="enlaces"]');
    vaciar(cont);
    if(!img.enlaces.length){
      cont.append(el('div',{class:'detalle__vacio', texto:'Sin enlaces todavía'}));
      return;
    }
    for(const id of img.enlaces){
      const otra = imagenes[id];
      if(!otra) continue;
      const chip = el('div',{class:'chip'},
        el('span',{texto:otra.nombre}),
        el('button',{type:'button',class:'chip__x',texto:'×',title:'Quitar enlace',
          onclick:() => quitarEnlace(img.id, id)})
      );
      cont.append(chip);
    }
  }

  function pintarSugerencias(img){
    const buscador = refs.detalle.querySelector('[data-campo="buscar-enlace"]');
    const resultados = refs.detalle.querySelector('[data-campo="resultados-enlace"]');
    buscador.value = '';
    vaciar(resultados);

    buscador.oninput = () => {
      const q = buscador.value.trim().toLowerCase();
      vaciar(resultados);
      if(q.length < 2) return;
      Object.values(imagenes)
        .filter(o => o.id !== img.id && !img.enlaces.includes(o.id) && o.nombre.toLowerCase().includes(q))
        .slice(0, 8)
        .forEach(o => {
          resultados.append(el('button',{type:'button',class:'sug',
            texto:o.nombre,
            onclick:() => { agregarEnlace(img.id, o.id); pintarSugerencias(img); }
          }));
        });
    };

    // FIX: Enter en el buscador no dispara submit implícito
    buscador.onkeydown = (e) => { if(e.key === 'Enter'){ e.preventDefault(); } };
  }

  function agregarEnlace(a, b){
    const A = imagenes[a], B = imagenes[b];
    if(!A || !B) return;
    if(!A.enlaces.includes(b)) A.enlaces.push(b);
    if(!B.enlaces.includes(a)) B.enlaces.push(a);
    guardar(); pintarEnlaces(A); pintarSugerencias(A); pintar();
  }
  function quitarEnlace(a, b){
    const A = imagenes[a], B = imagenes[b];
    if(A) A.enlaces = A.enlaces.filter(x => x !== b);
    if(B) B.enlaces = B.enlaces.filter(x => x !== a);
    guardar(); pintarEnlaces(A); pintar();
  }

  function aplicarCambiosDetalle(){
    const img = imagenes[detalleId]; if(!img) return;
    const d = refs.detalle;
    img.notas    = d.querySelector('[data-campo="notas"]').value;
    img.tags     = d.querySelector('[data-campo="tags"]').value
                     .split(',').map(s=>s.trim()).filter(Boolean);
    img.carpetas = d.querySelector('[data-campo="carpetas"]').value
                     .split(',').map(s=>s.trim()).filter(Boolean);

    img.carpetas.forEach(c => {
      if(!carpetasVirtuales.includes(c)) carpetasVirtuales.push(c);
    });

    guardar();
    pintar();
  }

  /* ---------- Montaje ---------- */
  function montar(contenedor){
    const cab = el('div',{class:'imagenes__cab'},
      el('h2',{style:'font-size:17px',texto:'Imágenes'}),
      el('span',{class:'imagenes__contador', dataset:{campo:'contador'}}),
      el('div',{style:'flex:1'}),
      (() => {
        // FIX: control para ver faltantes (antes imposible)
        const chk = el('input',{type:'checkbox'});
        chk.checked = filtro.faltantes;
        chk.addEventListener('change', () => { filtro.faltantes = chk.checked; pintar(); });
        return el('label',{style:'display:flex;align-items:center;gap:5px;font-size:13px;color:var(--suave)'},
          chk, el('span',{texto:'Ver faltantes'})
        );
      })(),
      el('button',{class:'primario',texto:'📁 Seleccionar carpeta',
        onclick: seleccionarCarpeta}),
      el('button',{texto:'🔄 Reescanear', title:'Volver a leer la carpeta seleccionada',
        onclick: () => refs.fileInput.click()}),
      el('span',{class:'imagenes__progreso', dataset:{campo:'progreso'}})
    );

    const barra = el('section',{class:'barra'},
      el('input',{type:'search',placeholder:'Buscar por nombre, nota, tag…', dataset:{campo:'buscar'}}),
      el('select',{dataset:{campo:'carpeta'}}),
      el('select',{dataset:{campo:'tag'}}),
      el('select',{dataset:{campo:'orden'}},
        el('option',{value:'reciente',texto:'Más recientes'}),
        el('option',{value:'nombre',texto:'Por nombre'}),
        el('option',{value:'carpeta',texto:'Por carpeta de disco'}),
        el('option',{value:'tamano',texto:'Por tamaño'})
      )
    );

    const stats = el('section',{class:'stats'});
    const galeria = el('div',{class:'galeria'});
    sentinel = el('div',{class:'galeria__sentinel'});

    const fileInput = el('input',{type:'file', multiple:'true', accept:'image/*',
      webkitdirectory:'true', directory:'true', hidden:'true'});
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files ? [...e.target.files] : [];
      e.target.value = '';
      if(files.length) procesarArchivos(files);
    });

    // --- diálogo de detalle ---
    // FIX: sin method="dialog" → Enter ya no cierra sin guardar
    const detalle = el('dialog',{class:'detalle'});
    const formDetalle = el('form',{class:'detalle__grid'},
      el('div',{class:'detalle__izq'},
        el('h3',{dataset:{campo:'nombre'}, style:'font-size:16px'}),
        el('div',{class:'detalle__path', dataset:{campo:'path'}}),
        el('div',{class:'detalle__preview', dataset:{campo:'preview'}})
      ),
      el('div',{class:'detalle__der'},
        el('div',{class:'campo'}, el('label',{texto:'Notas'}),
          el('textarea',{dataset:{campo:'notas'}, maxlength:'2000', placeholder:'Añade una nota…'})),
        el('div',{class:'campo'}, el('label',{texto:'Etiquetas (separadas por coma)'}),
          el('input',{type:'text', dataset:{campo:'tags'}, placeholder:'verano, familia, 2024'})),
        el('div',{class:'campo'}, el('label',{texto:'Carpetas virtuales'}),
          el('input',{type:'text', dataset:{campo:'carpetas'}, placeholder:'Vacaciones, Favoritas…'})),
        el('div',{class:'campo'}, el('label',{texto:'Enlaces'}),
          el('div',{class:'detalle__enlaces', dataset:{campo:'enlaces'}}),
          el('input',{type:'search', placeholder:'Buscar imagen para enlazar…',
            dataset:{campo:'buscar-enlace'}}),
          el('div',{class:'detalle__sugerencias', dataset:{campo:'resultados-enlace'}})
        ),
        el('div',{class:'pie'},
          el('button',{type:'button',texto:'Cerrar', onclick: cerrarDetalle}),
          el('button',{type:'submit',class:'primario',texto:'Guardar'})
        )
      )
    );
    // FIX: submit explícito que guarda antes de cerrar
    formDetalle.addEventListener('submit', (e) => {
      e.preventDefault();
      aplicarCambiosDetalle();
      cerrarDetalle();
    });
    detalle.append(formDetalle);

    // FIX: cerrar con ESC (u otra vía) también libera el objectURL
    detalle.addEventListener('close', liberarPreview);

    contenedor.append(cab, barra, stats, galeria, sentinel, fileInput, detalle);

    refs = {
      galeria, stats, fileInput, detalle,
      selCarpeta: barra.querySelector('[data-campo="carpeta"]'),
      selTag:     barra.querySelector('[data-campo="tag"]'),
      contador:   cab.querySelector('[data-campo="contador"]'),
      progreso:   cab.querySelector('[data-campo="progreso"]')
    };

    let tmr;
    barra.querySelector('[data-campo="buscar"]').addEventListener('input',(e)=>{
      clearTimeout(tmr); const v = e.target.value;
      tmr = setTimeout(() => { filtro.texto = v; pintar(); }, 130);
    });
    refs.selCarpeta.addEventListener('change', e => { filtro.carpeta = e.target.value; pintar(); });
    refs.selTag.addEventListener('change',     e => { filtro.tag     = e.target.value; pintar(); });
    barra.querySelector('[data-campo="orden"]').addEventListener('change', e => { filtro.orden = e.target.value; pintar(); });

    ro = new ResizeObserver(() => {
      if(!masonry) return;
      const w = columnWidthActual();
      if(masonry.options.columnWidth !== w){
        masonry.options.columnWidth = w;
        masonry.layout();
      }
    });
    ro.observe(galeria);

    cargar();
    pintar();
  }

  function desmontar(){
    generacion++;
    if(masonryPendiente){
      cancelAnimationFrame(masonryPendiente);
      masonryPendiente = null;
    }

    // FIX: cerrar detalle abierto + liberar preview
    liberarPreview();
    detalleId = null;
    try{ refs.detalle?.close(); }catch(e){}

    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();
    io && io.disconnect();
    ioMas && ioMas.disconnect();
    ro && ro.disconnect();
    masonry && masonry.destroy();
    io = null;
    ioMas = null;
    ro = null;
    masonry = null;
    refs = {};
  }

  Gestor.app.registrar({
    id: ID,
    nombre: 'Imágenes',
    icono: '🖼️',
    montar,
    desmontar
  });
})();