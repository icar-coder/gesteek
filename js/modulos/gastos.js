(() => {
  const { el, vaciar } = Gestor.dom;
  const util = Gestor.util;
  const almacen = Gestor.almacen;

  const ID = 'gastos';
  const CONFIG_KEY = 'gastos.config';
  const MONEDA = 'EUR';
  const LOCALE = 'es-ES';

  let movimientos = [];
  let editandoId = null;
  const filtro = { texto:'', tipo:'todos', categoria:'todas', mes:'actual', orden:'reciente' };
  let refs = {};
  let onKey = null;
  let tmrBuscar = null;

  let config = { objetivoAhorro: 20, ultimoAviso: '' };
  let chartEvol = null;
  let chartCat = null;

  const cargar = () => { movimientos = almacen.leer(ID, []) || []; };
  const guardar = () => almacen.escribir(ID, movimientos);
  const cargarConfig = () => {
    config = Object.assign({ objetivoAhorro: 20, ultimoAviso: '' }, almacen.leer(CONFIG_KEY, {}));
  };
  const guardarConfig = () => almacen.escribir(CONFIG_KEY, config);

  const fmt = new Intl.NumberFormat(LOCALE, { style:'currency', currency: MONEDA });
  const formatoMonto = (n) => fmt.format(Number(n) || 0);

  const mesActual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };
  const mesDe = (fecha) => (fecha ? String(fecha).slice(0,7) : '');

  function etiquetaMes(ym){
    if(!ym) return '—';
    const [y,m] = ym.split('-').map(Number);
    const d = new Date(y, m-1, 1);
    const s = d.toLocaleDateString(LOCALE, {month:'long', year:'numeric'});
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function etiquetaMesCorta(ym){
    if(!ym) return '';
    const [y,m] = ym.split('-').map(Number);
    return new Date(y, m-1, 1).toLocaleDateString(LOCALE, {month:'short'});
  }

  function mesesDisponibles(){
    const s = new Set();
    movimientos.forEach(m => { if(m.fecha) s.add(mesDe(m.fecha)); });
    s.add(mesActual());
    return [...s].sort().reverse();
  }

  function categoriasDisponibles(){
    const s = new Set();
    movimientos.forEach(m => { if(m.categoria) s.add(m.categoria); });
    ['Comida','Transporte','Casa','Ocio','Salud','Compras','Suscripciones','Nómina','Extras']
      .forEach(c => s.add(c));
    return [...s].sort((a,b)=>a.localeCompare(b,'es'));
  }

  function visibles(){
    const t = filtro.texto.trim().toLowerCase();
    const r = movimientos.filter(m => {
      if(filtro.tipo !== 'todos' && m.tipo !== filtro.tipo) return false;
      if(filtro.categoria !== 'todas' && m.categoria !== filtro.categoria) return false;
      if(filtro.mes !== 'todos' && mesDe(m.fecha) !== filtro.mes) return false;
      if(t){
        const blob = `${m.descripcion||''} ${m.notas||''} ${m.categoria||''}`.toLowerCase();
        if(!blob.includes(t)) return false;
      }
      return true;
    });
    r.sort((a,b) => {
      if(filtro.orden === 'monto') return (Number(b.monto)||0) - (Number(a.monto)||0);
      if(filtro.orden === 'antiguo') return (a.fecha||'').localeCompare(b.fecha||'') || ((a.creada||0)-(b.creada||0));
      return (b.fecha||'').localeCompare(a.fecha||'') || ((b.creada||0)-(a.creada||0));
    });
    return r;
  }

  function resumen(){
    const vis = visibles();
    let ingresos = 0, gastos = 0;
    for(const m of vis){
      const v = Number(m.monto) || 0;
      if(m.tipo === 'ingreso') ingresos += v;
      else gastos += v;
    }
    return { ingresos, gastos, balance: ingresos - gastos, count: vis.length };
  }

  function resumenDelMes(ym){
    let ingresos = 0, gastos = 0;
    for(const m of movimientos){
      if(mesDe(m.fecha) !== ym) continue;
      const v = Number(m.monto) || 0;
      if(m.tipo === 'ingreso') ingresos += v;
      else gastos += v;
    }
    return { ingresos, gastos };
  }

  function tasaAhorro(ingresos, gastos){
    if(ingresos <= 0) return null;
    return ((ingresos - gastos) / ingresos) * 100;
  }

  function gastosPorCategoria(){
    const map = new Map();
    for(const m of movimientos){
      if(m.tipo !== 'gasto') continue;
      if(filtro.mes !== 'todos' && mesDe(m.fecha) !== filtro.mes) continue;
      const c = m.categoria || 'Sin categoría';
      map.set(c, (map.get(c)||0) + (Number(m.monto)||0));
    }
    const arr = [...map.entries()].sort((a,b)=>b[1]-a[1]);
    const total = arr.reduce((s,[,v])=>s+v,0);
    return { arr, total };
  }

  function evolucionMensual(){
    const out = [];
    const hoy = new Date();
    for(let i=5;i>=0;i--){
      const d = new Date(hoy.getFullYear(), hoy.getMonth()-i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.push({ ym, label: etiquetaMesCorta(ym), ingresos:0, gastos:0 });
    }
    const map = new Map(out.map(m=>[m.ym,m]));
    for(const mov of movimientos){
      const slot = map.get(mesDe(mov.fecha));
      if(!slot) continue;
      const v = Number(mov.monto)||0;
      if(mov.tipo === 'ingreso') slot.ingresos += v;
      else slot.gastos += v;
    }
    return out;
  }

  /* ---------- Gráficas (Chart.js) ---------- */
  function leerColor(nombre, fallback){
    try{
      const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
      return v || fallback;
    }catch(e){ return fallback; }
  }

  function destruirGraficas(){
    if(chartEvol){ chartEvol.destroy(); chartEvol = null; }
    if(chartCat){ chartCat.destroy(); chartCat = null; }
  }

  function renderGraficas(){
    if(!window.Chart || !refs.canvasEvol || !refs.canvasCat) return;

    destruirGraficas();

    const texto  = leerColor('--texto', '#151a20');
    const suave  = leerColor('--suave', '#697586');
    const borde  = leerColor('--borde', '#e2e6ea');
    const acento = leerColor('--acento', '#3b82f6');
    const verde  = '#16a34a';
    const rojo   = '#dc2626';
    const gris   = 'rgba(127,127,127,.18)';

    // 1) Evolución mensual
    const ev = evolucionMensual();
    chartEvol = new Chart(refs.canvasEvol, {
      type: 'bar',
      data: {
        labels: ev.map(m => m.label),
        datasets: [
          {
            label: 'Ingresos',
            data: ev.map(m => m.ingresos),
            backgroundColor: verde,
            borderRadius: 6,
            maxBarThickness: 26
          },
          {
            label: 'Gastos',
            data: ev.map(m => m.gastos),
            backgroundColor: rojo,
            borderRadius: 6,
            maxBarThickness: 26
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: texto, boxWidth: 10, boxHeight: 10, usePointStyle: false }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatoMonto(ctx.raw)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: suave, autoSkip: false, maxRotation: 0 },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: suave,
              callback: (v) => formatoMonto(v)
            },
            grid: { color: gris }
          }
        }
      }
    });

    // 2) Doughnut de categorías
    const gc = gastosPorCategoria();
    const palette = [
      acento, '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
      '#ef4444', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
    ];
    chartCat = new Chart(refs.canvasCat, {
      type: 'doughnut',
      data: {
        labels: gc.arr.map(([c]) => c),
        datasets: [{
          data: gc.arr.map(([,v]) => v),
          backgroundColor: gc.arr.map((_,i) => palette[i % palette.length]),
          borderColor: borde,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = gc.total || 1;
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return ` ${ctx.label}: ${formatoMonto(ctx.raw)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ---------- Notificaciones ---------- */
  function notificacionesSoportadas(){
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  function pedirPermisoNotificaciones(){
    if(!notificacionesSoportadas()){
      alert('Este navegador no soporta notificaciones nativas.');
      return;
    }
    if(Notification.permission === 'granted'){
      notificar('Notificaciones activadas', 'Te avisaré cuando la tasa de ahorro baje del objetivo.');
      return;
    }
    if(Notification.permission === 'denied'){
      alert('Has bloqueado las notificaciones para este sitio. Actívalas desde la configuración del navegador.');
      return;
    }
    Notification.requestPermission().then((perm) => {
      if(perm === 'granted'){
        notificar('Notificaciones activadas', 'Te avisaré cuando la tasa de ahorro baje del objetivo.');
      }
    });
  }

  function notificar(titulo, cuerpo){
    if(!notificacionesSoportadas() || Notification.permission !== 'granted') return;
    try{
      new Notification(titulo, { body: cuerpo, tag: 'gestor-gastos' });
    }catch(e){
      // algunos navegadores lanzan en file:// o sin service worker; se ignora
      console.warn('Notification:', e);
    }
  }

  function comprobarObjetivo(){
    if(!notificacionesSoportadas() || Notification.permission !== 'granted') return;
    const mes = mesActual();
    if(config.ultimoAviso === mes) return;

    const { ingresos, gastos } = resumenDelMes(mes);
    const tasa = tasaAhorro(ingresos, gastos);
    if(tasa === null) return;

    if(tasa < config.objetivoAhorro){
      notificar(
        'Objetivo de ahorro',
        `Este mes ahorras el ${tasa.toFixed(1)}% (objetivo ${config.objetivoAhorro}%).`
      );
      config.ultimoAviso = mes;
      guardarConfig();
    }
  }

  /* ---------- Render ---------- */
  function pintar(){
    const { lista, stats, selCat, selMes, datalist, catResumen, ahorro } = refs;
    if(!lista) return;

    const cats = categoriasDisponibles();
    vaciar(selCat);
    selCat.append(el('option',{value:'todas',texto:'Todas las categorías'}));
    cats.forEach(c => selCat.append(el('option',{value:c,texto:c})));
    selCat.value = cats.includes(filtro.categoria) ? filtro.categoria : 'todas';
    filtro.categoria = selCat.value;

    const meses = mesesDisponibles();
    vaciar(selMes);
    selMes.append(el('option',{value:'todos',texto:'Todos los meses'}));
    meses.forEach(m => selMes.append(el('option',{value:m,texto:etiquetaMes(m)})));
    if(filtro.mes !== 'todos' && !meses.includes(filtro.mes)){
      filtro.mes = meses.includes(mesActual()) ? mesActual() : (meses[0] || 'todos');
    }
    selMes.value = filtro.mes;

    vaciar(datalist);
    cats.forEach(c => datalist.append(el('option',{value:c})));

    const r = resumen();
    vaciar(stats);
    stats.append(el('span',{texto:`${r.count} movimientos`}));
    stats.append(el('span',{class:'gastos--ingreso', texto:`↑ ${formatoMonto(r.ingresos)}`}));
    stats.append(el('span',{class:'gastos--gasto',   texto:`↓ ${formatoMonto(r.gastos)}`}));
    stats.append(el('span',{
      class: r.balance >= 0 ? 'gastos--positivo' : 'gastos--negativo',
      texto:`Balance: ${formatoMonto(r.balance)}`
    }));

    // tasa de ahorro (período filtrado)
    const tasa = tasaAhorro(r.ingresos, r.gastos);
    pintarAhorro(tasa, r.ingresos);

    // resumen textual por categoría (se mantiene; el doughnut lo complementa)
    const gc = gastosPorCategoria();
    vaciar(catResumen);
    if(gc.total > 0){
      catResumen.append(el('h3',{class:'gastos__sub', texto:'Gastos por categoría'}));
      const cont = el('div',{class:'gastos__barras'});
      for(const [c, v] of gc.arr){
        const pct = (v / gc.total) * 100;
        cont.append(el('div',{class:'gastos__barra-fila'},
          el('span',{class:'gastos__barra-cat', texto:c}),
          el('div',{class:'gastos__barra-track'},
            el('div',{class:'gastos__barra-fill', style:`width:${pct.toFixed(1)}%`})
          ),
          el('span',{class:'gastos__barra-val', texto:formatoMonto(v)})
        ));
      }
      catResumen.append(cont);
    }

    // lista
    const vis = visibles();
    vaciar(lista);
    if(!vis.length){
      const v = el('div',{class:'vacio'});
      v.append(el('div',{texto: movimientos.length ? '🔍 Nada coincide' : '💸 Todavía no hay movimientos'}));
      v.append(el('div',{style:'margin-top:6px;font-size:13px',
        texto: movimientos.length ? 'Cambia los filtros.' : 'Pulsa "+ Nuevo" para empezar.'}));
      lista.append(v);
    } else {
      let mesAgrupado = null;
      for(const m of vis){
        const mes = mesDe(m.fecha);
        if(mes !== mesAgrupado){
          mesAgrupado = mes;
          if(mes) lista.append(el('li',{class:'gastos__mes', texto:etiquetaMes(mes)}));
        }
        lista.append(fila(m));
      }
    }

    renderGraficas();
  }

  function pintarAhorro(tasa, ingresos){
    const cont = refs.ahorro;
    if(!cont) return;
    vaciar(cont);

    const obj = Number(config.objetivoAhorro) || 20;
    const valor = tasa === null ? '—' : `${tasa.toFixed(1)}%`;
    const pctBarra = tasa === null ? 0 : Math.max(0, Math.min(100, tasa));

    let clase = 'gastos__ahorro-card';
    if(tasa !== null){
      if(tasa >= obj) clase += ' ok';
      else if(tasa >= 0) clase += ' aviso';
      else clase += ' mal';
    }

    cont.append(el('div',{class:clase},
      el('div',{class:'gastos__ahorro-cab'},
        el('span',{class:'gastos__ahorro-label', texto:'Tasa de ahorro'}),
        el('span',{class:'gastos__ahorro-valor', texto:valor})
      ),
      el('div',{class:'gastos__ahorro-barra'},
        el('div',{class:'gastos__ahorro-fill', style:`width:${pctBarra}%`})
      ),
      el('div',{class:'gastos__ahorro-pie'},
        el('span',{texto: `Objetivo: ${obj}%`}),
        (() => {
          const btn = el('button',{
            type:'button', class:'gastos__ahorro-btn',
            texto: notificacionesSoportadas() && Notification.permission === 'granted'
              ? '🔔 Notificaciones activas'
              : '🔔 Activar notificaciones',
            onclick: pedirPermisoNotificaciones
          });
          return btn;
        })()
      )
    ));

    // input de objetivo (separado para no perder foco al repintar)
    if(!refs.objetivoInput){
      const inp = el('input',{
        type:'number', min:'0', max:'100', step:'1', value: obj,
        class:'gastos__objetivo-input', title:'Objetivo de ahorro (%)'
      });
      inp.addEventListener('change', () => {
        const v = Math.max(0, Math.min(100, Number(inp.value) || 0));
        config.objetivoAhorro = v;
        inp.value = v;
        guardarConfig();
        pintar();
      });
      refs.objetivoInput = inp;
      cont.append(inp);
    } else {
      refs.objetivoInput.value = obj;
      cont.append(refs.objetivoInput);
    }
  }

  function fila(m){
    const esIngreso = m.tipo === 'ingreso';

    const meta = el('div',{class:'mov__meta'});
    if(m.categoria) meta.append(el('span',{class:'tag',texto:m.categoria}));
    if(m.fecha)     meta.append(el('span',{texto:util.formatoFecha(m.fecha)}));

    const cuerpo = el('div',{class:'mov__cuerpo'},
      el('div',{class:'mov__desc', texto:m.descripcion}),
      meta.children.length ? meta : null
    );
    if(m.notas) cuerpo.append(el('div',{class:'mov__notas', texto:m.notas}));

    return el('li',{class:'item-mov '+(esIngreso?'es-ingreso':'es-gasto')},
      el('span',{class:'mov__tipo '+(esIngreso?'ingreso':'gasto'), texto: esIngreso?'💰':'💸'}),
      cuerpo,
      el('div',{class:'mov__monto '+(esIngreso?'ingreso':'gasto'),
        texto: (esIngreso?'+':'−') + formatoMonto(Number(m.monto)||0)}),
      el('div',{class:'acciones'},
        el('button',{class:'icono',title:'Editar',texto:'✏️',onclick:()=>abrirEdicion(m.id)}),
        el('button',{class:'icono',title:'Eliminar',texto:'🗑️',onclick:()=>borrar(m.id)})
      )
    );
  }

  function borrar(id){
    const m = movimientos.find(x=>x.id===id); if(!m) return;
    if(!confirm(`¿Eliminar "${m.descripcion}"?`)) return;
    movimientos = movimientos.filter(x=>x.id!==id);
    guardar(); pintar();
  }

  function abrirNuevo(){
    editandoId = null;
    refs.form.reset();
    refs.dlgTitulo.textContent = 'Nuevo movimiento';
    refs.tipo.value = 'gasto';
    refs.fecha.value = util.hoyISO();
    refs.dlg.showModal();
    setTimeout(()=>refs.monto?.focus(),50);
  }

  function abrirEdicion(id){
    const m = movimientos.find(x=>x.id===id); if(!m) return;
    editandoId = id;
    refs.dlgTitulo.textContent = 'Editar';
    refs.tipo.value = m.tipo || 'gasto';
    refs.monto.value = m.monto || '';
    refs.descripcion.value = m.descripcion || '';
    refs.categoria.value = m.categoria || '';
    refs.fecha.value = m.fecha || '';
    refs.notas.value = m.notas || '';
    refs.dlg.showModal();
    setTimeout(()=>refs.monto?.focus(),50);
  }

  function montar(contenedor){
    const barra = el('section',{class:'barra--gastos'},
      el('input',{id:'g-buscar',type:'search',placeholder:'Buscar…'}),
      el('select',{id:'g-tipo'},
        el('option',{value:'todos',texto:'Todo'}),
        el('option',{value:'gasto',texto:'Gastos'}),
        el('option',{value:'ingreso',texto:'Ingresos'})
      ),
      el('select',{id:'g-cat'}),
      el('select',{id:'g-mes'}),
      el('select',{id:'g-orden'},
        el('option',{value:'reciente',texto:'Más recientes'}),
        el('option',{value:'antiguo',texto:'Más antiguos'}),
        el('option',{value:'monto',texto:'Por monto'})
      )
    );

    const cab = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap'},
      el('h2',{style:'font-size:17px',texto:'Gastos'}),
      el('button',{class:'primario',texto:'+ Nuevo',onclick:abrirNuevo})
    );

    const stats      = el('section',{class:'stats'});
    const ahorro     = el('section',{class:'gastos__ahorro'});
    const graficas   = el('section',{class:'gastos__graficas'},
      el('div',{class:'gastos__chart-card'},
        el('h3',{class:'gastos__sub', texto:'Evolución mensual'}),
        el('div',{class:'gastos__chart-wrap'}, el('canvas',{id:'g-chart-evol'}))
      ),
      el('div',{class:'gastos__chart-card'},
        el('h3',{class:'gastos__sub', texto:'Gastos por categoría'}),
        el('div',{class:'gastos__chart-wrap'}, el('canvas',{id:'g-chart-cat'}))
      )
    );
    const catResumen = el('section',{class:'gastos__resumen'});
    const lista      = el('ul',{class:'lista'});

    const dlg = el('dialog',{id:'g-dlg'});
    const form = el('form',{class:'form'});
    const dlgTitulo = el('h2',{style:'font-size:17px',texto:'Nuevo movimiento'});
    const tipo = el('select',{},
      el('option',{value:'gasto',texto:'💸 Gasto'}),
      el('option',{value:'ingreso',texto:'💰 Ingreso'})
    );
    const monto = el('input',{type:'number',step:'0.01',min:'0',placeholder:'0,00',required:'true'});
    const descripcion = el('input',{type:'text',maxlength:'120',placeholder:'¿En qué?',required:'true'});
    const categoria = el('input',{list:'g-listaCats',maxlength:'30',placeholder:'Comida…'});
    const datalist = el('datalist',{id:'g-listaCats'});
    const fecha = el('input',{type:'date'});
    const notas = el('textarea',{maxlength:'1000',placeholder:'Notas opcionales…'});

    form.append(
      dlgTitulo,
      el('div',{class:'fila2'},
        el('div',{class:'campo'}, el('label',{texto:'Tipo'}), tipo),
        el('div',{class:'campo'}, el('label',{texto:'Monto *'}), monto)
      ),
      el('div',{class:'campo'}, el('label',{texto:'Descripción *'}), descripcion),
      el('div',{class:'fila2'},
        el('div',{class:'campo'}, el('label',{texto:'Categoría'}), categoria, datalist),
        el('div',{class:'campo'}, el('label',{texto:'Fecha'}), fecha)
      ),
      el('div',{class:'campo'}, el('label',{texto:'Notas'}), notas),
      el('div',{class:'pie'},
        el('button',{type:'button',texto:'Cancelar',onclick:()=>dlg.close()}),
        el('button',{type:'submit',class:'primario',texto:'Guardar'})
      )
    );
    dlg.append(form);

    contenedor.append(cab, barra, stats, ahorro, graficas, catResumen, lista, dlg);

    refs = {
      dlg, form, dlgTitulo, tipo, monto, descripcion, categoria, fecha, notas,
      lista, stats, catResumen, ahorro, datalist,
      canvasEvol: graficas.querySelector('#g-chart-evol'),
      canvasCat:  graficas.querySelector('#g-chart-cat'),
      selCat: barra.querySelector('#g-cat'),
      selMes: barra.querySelector('#g-mes'),
      objetivoInput: null
    };

    barra.querySelector('#g-buscar').addEventListener('input',(e)=>{
      clearTimeout(tmrBuscar); const v = e.target.value;
      tmrBuscar = setTimeout(()=>{ filtro.texto = v; pintar(); }, 130);
    });
    barra.querySelector('#g-tipo').addEventListener('change',(e)=>{ filtro.tipo = e.target.value; pintar(); });
    barra.querySelector('#g-orden').addEventListener('change',(e)=>{ filtro.orden = e.target.value; pintar(); });
    refs.selCat.addEventListener('change',(e)=>{ filtro.categoria = e.target.value; pintar(); });
    refs.selMes.addEventListener('change',(e)=>{ filtro.mes = e.target.value; pintar(); });

    form.addEventListener('submit',(e)=>{
      e.preventDefault();
      const datos = {
        tipo: tipo.value,
        monto: parseFloat(monto.value),
        descripcion: descripcion.value.trim(),
        categoria: categoria.value.trim(),
        fecha: fecha.value,
        notas: notas.value.trim()
      };
      if(!datos.descripcion){ descripcion.focus(); return; }
      if(!isFinite(datos.monto) || datos.monto <= 0){ monto.focus(); return; }

      if(editandoId){
        const it = movimientos.find(x=>x.id===editandoId);
        if(it) Object.assign(it, datos);
      } else {
        movimientos.push({ id: util.uid(), ...datos, creada: Date.now() });
      }
      guardar(); dlg.close(); pintar();
      comprobarObjetivo();
    });

    dlg.addEventListener('click',(e)=>{
      const r = dlg.getBoundingClientRect();
      const fuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if(fuera) dlg.close();
    });

    onKey = (e) => {
      if(dlg.open) return;
      const tag = (e.target.tagName||'').toLowerCase();
      if(tag==='input'||tag==='textarea'||tag==='select') return;
      if(e.key==='n'||e.key==='N'){ e.preventDefault(); abrirNuevo(); }
      if(e.key==='/'){ e.preventDefault(); barra.querySelector('#g-buscar').focus(); }
    };
    document.addEventListener('keydown', onKey);

    cargar();
    cargarConfig();
    pintar();
  }

  function desmontar(){
    if(onKey){ document.removeEventListener('keydown', onKey); onKey = null; }
    if(tmrBuscar){ clearTimeout(tmrBuscar); tmrBuscar = null; }
    try{ refs.dlg?.close(); }catch(e){}
    destruirGraficas();
    refs = {};
    editandoId = null;
  }

  Gestor.app.registrar({
    id: ID,
    nombre: 'Gastos',
    icono: '💸',
    montar,
    desmontar
  });
})();