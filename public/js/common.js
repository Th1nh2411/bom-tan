const COLORS = ['#c77f8c','#7d9bc4','#c9b27a','#8fac7a','#9d8fbf','#c08a62','#86adc0','#b98fb0'];
const TEAM_NAMES = ['Đội Đỏ', 'Đội Xanh'];
const TEAM_SHADES = [['#c77f8c','#d6a4ad','#a3606c','#e0c1c6'], ['#7d9bc4','#a6b8d6','#5a769e','#86adc0']];
const EMOTES = ['😂','😡','👋','😱','👍','🔥'];
const PORTAL_COLORS = ['#9d8fbf', '#86adc0'];
const $ = id => document.getElementById(id);
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim().slice(0, 12);
const safeKey = s => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180) || 'x';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
