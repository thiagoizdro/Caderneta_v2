// Aplica o tema salvo antes do primeiro paint (sem "piscar" claro → escuro).
try {
    var t = localStorage.getItem('caderneta:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* armazenamento indisponível */ }
