
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// =============================================
// CONFIGURAÇÃO
// =============================================

const firebaseConfig = {
  apiKey: "AIzaSyD6SCD044JZ2Wvc5u6gu2tPfsgBgwUYKkk",
  authDomain: "barsorte-b8d5a.firebaseapp.com",
  projectId: "barsorte-b8d5a",
  storageBucket: "barsorte-b8d5a.firebasestorage.app",
  messagingSenderId: "805597809047",
  appId: "1:805597809047:web:b85f71837b992b752edcd2",
  measurementId: "G-556D60HG9R"
};

// Precisa ser o MESMO UID configurado nas regras.
const ADMIN_UID = "4gUdxoqAaLaMfZ9vjafSbY5rfWB3";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

const money = cents =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency", currency: "BRL"
  });

const safe = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

let user = null;
let currentBar = null;
let rounds = [];
let selectedRoundId = null;
let unsubscribeBar = null;
let unsubscribeRounds = null;
let unsubscribeAdmin = null;
let authVersion = 0;

function show(view) {
  ["loginView", "blockedView", "adminView", "barView"]
    .forEach(id => $(id).classList.add("hidden"));
  $(view).classList.remove("hidden");
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), 3500);
}

function handleError(error) {
  console.error(error);
  toast("Erro: " + (error.code || error.message));
}

function clearListeners() {
  unsubscribeBar?.();
  unsubscribeRounds?.();
  unsubscribeAdmin?.();
  unsubscribeBar = null;
  unsubscribeRounds = null;
  unsubscribeAdmin = null;
}

// =============================================
// LOGIN
// =============================================

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("loginError").textContent = "";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (error) {
    console.error(error);
    $("loginError").textContent =
      "Não foi possível entrar. Confira seu e-mail e senha.";
  }
});

$("btnLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async loggedUser => {
  const version = ++authVersion;
  clearListeners();
  user = loggedUser;
  currentBar = null;
  rounds = [];
  selectedRoundId = null;

  $("btnLogout").classList.toggle("hidden", !user);
  $("userLabel").textContent = user?.email || "";

  if (!user) {
    show("loginView");
    return;
  }

  if (user.uid === ADMIN_UID) {
    show("adminView");
    startAdmin();
    return;
  }

  const barRef = doc(db, "bares", user.uid);

  unsubscribeBar = onSnapshot(barRef, snapshot => {
    if (version !== authVersion) return;

    if (!snapshot.exists()) {
      show("blockedView");
      clearBarRounds();
      return;
    }

    currentBar = { id: snapshot.id, ...snapshot.data() };

    if (currentBar.status !== "ativo") {
      show("blockedView");
      clearBarRounds();
      return;
    }

    $("barTitle").textContent = currentBar.nome;
    show("barView");
    if (!unsubscribeRounds) startBarRounds();
  }, handleError);
});

function clearBarRounds() {
  unsubscribeRounds?.();
  unsubscribeRounds = null;
  rounds = [];
  selectedRoundId = null;
  $("roundDetail").classList.add("hidden");
}

// =============================================
// ADMINISTRAÇÃO
// =============================================

let adminBars = [];

function startAdmin() {
  unsubscribeAdmin = onSnapshot(
    collection(db, "bares"),
    snapshot => {
      adminBars = snapshot.docs.map(d => ({
        id: d.id, ...d.data()
      }));
      renderAdminBars();
      refreshAdminReports().catch(handleError);
    },
    handleError
  );
}

function renderAdminBars() {
  $("totalBares").textContent = adminBars.length;
  $("totalAtivos").textContent = adminBars.filter(
    bar => bar.status === "ativo"
  ).length;

  $("barsTable").innerHTML = adminBars.map(bar => `
    <tr>
      <td>
        <b>${safe(bar.nome)}</b><br>
        <small>${safe(bar.id)}</small>
      </td>
      <td>
        <span class="tag ${bar.status === "ativo" ?
          "active" : "blocked"}">
          ${bar.status === "ativo" ? "Ativo" : "Bloqueado"}
        </span>
      </td>
      <td>
        <button class="btn ${bar.status === "ativo" ?
          "danger" : "success"}"
          data-toggle="${safe(bar.id)}">
          ${bar.status === "ativo" ? "Bloquear" : "Liberar"}
        </button>
      </td>
    </tr>
  `).join("");
}

$("barsTable").addEventListener("click", async event => {
  const button = event.target.closest("[data-toggle]");
  if (!button) return;

  const bar = adminBars.find(b => b.id === button.dataset.toggle);
  if (!bar) return;

  const novoStatus = bar.status === "ativo" ?
    "bloqueado" : "ativo";

  if (!confirm(`Alterar ${bar.nome} para ${novoStatus}?`)) return;

  try {
    await updateDoc(doc(db, "bares", bar.id), {
      status: novoStatus
    });
    toast("Status atualizado.");
  } catch (error) {
    handleError(error);
  }
});

$("barForm").addEventListener("submit", async event => {
  event.preventDefault();

  const nome = $("barName").value.trim();
  const uid = $("barUid").value.trim();

  if (!nome || !uid) return;

  try {
    const reference = doc(db, "bares", uid);

    if ((await getDoc(reference)).exists()) {
      toast("Este UID já está cadastrado.");
      return;
    }

    await setDoc(reference, {
      nome,
      status: "ativo",
      criadoEm: serverTimestamp()
    });

    $("barForm").reset();
    toast("Estabelecimento cadastrado.");
  } catch (error) {
    handleError(error);
  }
});

async function refreshAdminReports() {
  let allRounds = [];

  // Busca as rodadas de cada estabelecimento cadastrado.
  // Versão simples, indicada para poucos estabelecimentos.
  const results = await Promise.all(adminBars.map(async bar => {
    const snapshot = await getDocs(
      collection(db, "bares", bar.id, "rodadas")
    );

    return snapshot.docs.map(d => ({
      id: d.id,
      barName: bar.nome,
      ...d.data()
    }));
  }));

  allRounds = results.flat();
  allRounds.sort((a, b) =>
    (b.criadoEm?.seconds || 0) -
    (a.criadoEm?.seconds || 0)
  );

  let total = 0;
  let commission = 0;

  $("adminRoundsTable").innerHTML = allRounds.map(round => {
    const count = (round.numeros || []).length;
    const revenue = count * round.precoCentavos;
    const fee = Math.round(revenue * 0.05);
    total += revenue;
    commission += fee;

    return `
      <tr>
        <td>${safe(round.barName)}</td>
        <td>${safe(round.nome)}</td>
        <td>${round.status === "encerrada" ?
          "Encerrada" : "Aberta"}</td>
        <td>${count}</td>
        <td>${money(revenue)}</td>
        <td>${money(fee)}</td>
        <td>${round.resultado ?? "—"}</td>
      </tr>`;
  }).join("");

  $("totalArrecadacao").textContent = money(total);
  $("totalComissao").textContent = money(commission);
}

// =============================================
// PAINEL DO ESTABELECIMENTO
// =============================================

function roundsCollection() {
  return collection(db, "bares", user.uid, "rodadas");
}

function roundReference(id) {
  return doc(db, "bares", user.uid, "rodadas", id);
}

function startBarRounds() {
  unsubscribeRounds = onSnapshot(roundsCollection(), snapshot => {
    rounds = snapshot.docs.map(d => ({
      id: d.id, ...d.data()
    }));

    rounds.sort((a, b) =>
      (b.criadoEm?.seconds || 0) -
      (a.criadoEm?.seconds || 0)
    );

    renderRounds();
    renderBarStats();

    if (selectedRoundId) renderRoundDetail();
  }, handleError);
}

$("roundForm").addEventListener("submit", async event => {
  event.preventDefault();

  const nome = $("roundName").value.trim();
  const preco = Number($("roundPrice").value);
  const precoCentavos = Math.round(preco * 100);

  if (!nome || !Number.isFinite(preco) ||
      preco <= 0 || preco > 1000) {
    toast("Informe um nome e valor fictício válido.");
    return;
  }

  try {
    // A regra do Firestore confere se o bar está ativo.
    await addDoc(roundsCollection(), {
      nome,
      precoCentavos,
      numeros: [],
      status: "aberta",
      resultado: null,
      criadoEm: serverTimestamp()
    });

    $("roundForm").reset();
    toast("Rodada demonstrativa criada.");
  } catch (error) {
    handleError(error);
  }
});

function renderRounds() {
  $("roundsList").innerHTML = rounds.length ?
    rounds.map(round => `
      <div class="round-item">
        <div>
          <h3>${safe(round.nome)}</h3>
          <p>
            ${round.numeros?.length || 0}/100 registrados •
            ${round.status === "aberta" ? "Aberta" : "Encerrada"}
          </p>
        </div>
        <button class="btn secondary"
          data-round="${safe(round.id)}">
          Visualizar
        </button>
      </div>
    `).join("") :
    '<p>Nenhuma rodada criada.</p>';
}

$("roundsList").addEventListener("click", event => {
  const button = event.target.closest("[data-round]");
  if (!button) return;

  selectedRoundId = button.dataset.round;
  $("roundDetail").classList.remove("hidden");
  renderRoundDetail();
  $("roundDetail").scrollIntoView({ behavior: "smooth" });
});

$("closeDetail").addEventListener("click", () => {
  selectedRoundId = null;
  $("roundDetail").classList.add("hidden");
});

function renderBarStats() {
  const count = rounds.reduce(
    (sum, r) => sum + (r.numeros?.length || 0), 0
  );

  const revenue = rounds.reduce(
    (sum, r) => sum +
      (r.numeros?.length || 0) * r.precoCentavos, 0
  );

  $("barTotalRounds").textContent = rounds.length;
  $("barNumbers").textContent = count;
  $("barRevenue").textContent = money(revenue);
  $("barCommission").textContent = money(
    rounds.reduce((sum, r) => sum + Math.round(
      (r.numeros?.length || 0) * r.precoCentavos * 0.05
    ), 0)
  );
}

function renderRoundDetail() {
  const round = rounds.find(r => r.id === selectedRoundId);
  if (!round) {
    $("roundDetail").classList.add("hidden");
    return;
  }

  const numeros = round.numeros || [];
  const used = new Map(numeros.map(n => [n.numero, n.nome]));
  const revenue = numeros.length * round.precoCentavos;
  const closed = round.status === "encerrada";

  $("selectedRoundTitle").textContent = round.nome;

  $("numberGrid").innerHTML =
    Array.from({ length: 100 }, (_, index) => {
      const n = index + 1;
      const taken = used.has(n);

      return `
        <button type="button"
          class="number ${taken ? "taken" : ""}"
          data-number="${n}"
          ${taken || closed ? "disabled" : ""}
          title="${taken ? safe(used.get(n)) : "Disponível"}">
          ${String(n).padStart(2, "0")}
        </button>
      `;
    }).join("");

  $("roundCount").textContent = numeros.length;
  $("roundRevenue").textContent = money(revenue);
  $("roundPrize").textContent = money(
    Math.round(revenue * 0.50)
  );
  $("roundFee").textContent = money(
    Math.round(revenue * 0.05)
  );

  $("numberForm").classList.toggle("hidden", closed);
  $("drawButton").disabled = closed || numeros.length === 0;

  $("roundResult").textContent = closed ?
    `Resultado demonstrativo: número ${round.resultado}` :
    "Rodada aberta";
}

$("numberGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-number]");
  if (!button || button.disabled) return;

  $("selectedNumber").value = button.dataset.number;
  $("participantName").focus();
});

$("numberForm").addEventListener("submit", async event => {
  event.preventDefault();

  const numero = Number($("selectedNumber").value);
  const nome = $("participantName").value.trim();

  if (!Number.isInteger(numero) || numero < 1 ||
      numero > 100 || !nome || nome.length > 80) {
    toast("Confira os dados do participante.");
    return;
  }

  try {
    const barRef = doc(db, "bares", user.uid);
    const ref = roundReference(selectedRoundId);

    await runTransaction(db, async transaction => {
      const barSnap = await transaction.get(barRef);
      const snapshot = await transaction.get(ref);

      if (barSnap.data()?.status !== "ativo") {
        throw new Error("Estabelecimento bloqueado.");
      }

      if (!snapshot.exists()) {
        throw new Error("Rodada não encontrada.");
      }

      const data = snapshot.data();
      const numeros = data.numeros || [];

      if (data.status !== "aberta") {
        throw new Error("Rodada encerrada.");
      }

      if (numeros.some(item => item.numero === numero)) {
        throw new Error("Número já registrado.");
      }

      if (numeros.length >= 100) {
        throw new Error("Todos os números estão ocupados.");
      }

      transaction.update(ref, {
        numeros: [...numeros, { numero, nome }]
      });
    });

    $("numberForm").reset();
    toast("Número demonstrativo registrado.");
  } catch (error) {
    handleError(error);
  }
});

// =============================================
// SIMULAÇÃO DO RESULTADO
// =============================================

$("drawButton").addEventListener("click", async () => {
  if (!selectedRoundId) return;

  if (!confirm("Encerrar e simular o resultado desta rodada?")) {
    return;
  }

  try {
    const barRef = doc(db, "bares", user.uid);
    const ref = roundReference(selectedRoundId);

    await runTransaction(db, async transaction => {
      const barSnap = await transaction.get(barRef);
      const snapshot = await transaction.get(ref);

      if (barSnap.data()?.status !== "ativo") {
        throw new Error("Estabelecimento bloqueado.");
      }

      if (!snapshot.exists()) {
        throw new Error("Rodada não encontrada.");
      }

      const data = snapshot.data();

      if (data.status !== "aberta") {
        throw new Error("Esta rodada já foi encerrada.");
      }

      const numeros = data.numeros || [];

      if (!numeros.length) {
        throw new Error("Não há números registrados.");
      }

      // Somente simulação, sem prêmio ou valor real.
      // Distribuição sem viés de módulo.
      const limite = Math.floor(4294967296 / numeros.length)
        * numeros.length;
      const bytes = new Uint32Array(1);
      let randomValue;

      do {
        crypto.getRandomValues(bytes);
        randomValue = bytes[0];
      } while (randomValue >= limite);

      const indice = randomValue % numeros.length;
      const resultado = numeros[indice].numero;

      transaction.update(ref, {
        status: "encerrada",
        resultado
      });
    });

    toast("Simulação concluída.");
  } catch (error) {
    handleError(error);
  }
});
