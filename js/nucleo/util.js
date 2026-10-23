window.Gestor = window.Gestor || {};
Gestor.util = (() => {
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function hoyISO(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function formatoFecha(iso){
    if(!iso) return '';
    const [y,m,d] = iso.split('-').map(Number);
    const fecha = new Date(y, m-1, d);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const diff = Math.round((fecha - hoy)/86400000);
    if(diff === 0) return 'Hoy';
    if(diff === 1) return 'Mañana';
    if(diff === -1) return 'Ayer';
    const txt = fecha.toLocaleDateString('es',{day:'numeric',month:'short'});
    return diff < 0 ? 'Vencida · ' + txt : txt;
  }

  const esVencida = (iso) => !!iso && iso < hoyISO();
  const escapar = (s) => String(s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));

  return { uid, hoyISO, formatoFecha, esVencida, escapar };
})();