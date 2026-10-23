Gestor.dom = (() => {
  const $  = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

  function el(tag, props = {}, ...hijos){
    const n = document.createElement(tag);
    for(const [k,v] of Object.entries(props)){
      if(v === null || v === undefined || v === false) continue;
      if(k === 'class') n.className = v;
      else if(k === 'texto') n.textContent = v;
      else if(k === 'html') n.innerHTML = v;
      else if(k === 'dataset') Object.assign(n.dataset, v);
      else if(k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for(const h of hijos.flat()){
      if(h === null || h === undefined || h === false) continue;
      n.append(h.nodeType ? h : document.createTextNode(String(h)));
    }
    return n;
  }

  const vaciar = (nodo) => { while(nodo.firstChild) nodo.removeChild(nodo.firstChild); };

  return { $, $$, el, vaciar };
})();