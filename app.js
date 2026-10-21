
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
// CONFIGURAÇÃO DO FIREBASE
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

const ADMIN_UID = "4gUdxoqAaLaMfZ9vjafSbY5rfWB3";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

const $ = id => document.getElementById(id);

const money = cents =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const safe = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function show(view) {
  ["loginView", "blockedView", "adminView", "barView"]
    .forEach(id => $(id).classList.add("hidden"));

  $(view).classList.remove("hidden");
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");

  setTimeout(() => {
    $("toast").classList.add("hidden");
  }, 3500);
}

function handleError(error) {
  console.error(error);
  toast("Erro: " + (error.message || error.code));
}

// =============================================
// VARIÁVEIS GLOBAIS
// =============================================

let user = null;
let currentBar = null;
let rounds = [];
let selectedRoundId = null;

let selectedNumbers = new Set();

const MAX_SELECTION = 20;

let unsubscribeBar = null;
let unsubscribeRounds = null;
let unsubscribeAdmin = null;

let authVersion = 0;

// =============================================
// SELEÇÃO MÚLTIPLA
// =============================================

function updateSelection() {
  const round = rounds.find(
    r => r.id === selectedRoundId
  );

  const price = round?.precoCentavos || 0;

  const numbers = [...selectedNumbers]
    .sort((a, b) => a - b);

  $("selectedNumbersInfo").textContent =
    numbers.length
      ? numbers.map(n =>
          String(n).padStart(2, "0")
        ).join(", ")
      : "Nenhum número selecionado";

  $("selectionCount").textContent =
    `${numbers.length} número(s) selecionado(s)`;

  $("selectionTotal").textContent =
    money(numbers.length * price);
}

function clearListeners() {
  unsubscribeBar?.();
  unsubscribeRounds?.();
  unsubscribeAdmin?.();

  unsubscribeBar = null;
  unsubscribeRounds = null;
  unsubscribeAdmin = null;
}

function clearBarRounds() {
  unsubscribeRounds?.();
  unsubscribeRounds = null;

  rounds = [];
  selectedRoundId = null;

  selectedNumbers.clear();

  $("roundDetail").classList.add("hidden");
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

$("btnLogout").addEventListener("click", () => {
  signOut(auth);
});

// =============================================
// IDENTIFICAR USUÁRIO
// =============================================

onAuthStateChanged(auth, loggedUser => {
  const version = ++authVersion;

  clearListeners();

  user = loggedUser;
  currentBar = null;

  rounds = [];
  selectedRoundId = null;
  selectedNumbers.clear();

  $("btnLogout").classList.toggle(
    "hidden",
    !user
  );

  $("userLabel").textContent =
    user?.email || "";

  if (!user) {
    show("loginView");
    return;
  }

  // ADMINISTRADOR

  if (user.uid === ADMIN_UID) {
    show("adminView");
    startAdmin();
    return;
  }

  // ESTABELECIMENTO

  const barRef = doc(
    db,
    "bares",
    user.uid
  );

  unsubscribeBar = onSnapshot(
    barRef,
    snapshot => {
      if (version !== authVersion) return;

      if (!snapshot.exists()) {
        show("blockedView");
        clearBarRounds();
        return;
      }

      currentBar = {
        id: snapshot.id,
        ...snapshot.data()
      };

      if (currentBar.status !== "ativo") {
        show("blockedView");
        clearBarRounds();
        return;
      }

      $("barTitle").textContent =
        currentBar.nome;

      show("barView");

      if (!unsubscribeRounds) {
        startBarRounds();
      }
    },
    handleError
  );
});

// =============================================
// PAINEL ADMINISTRATIVO
// =============================================

let adminBars = [];

function startAdmin() {
  unsubscribeAdmin = onSnapshot(
    collection(db, "bares"),
    snapshot => {
      adminBars = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      renderAdminBars();

      refreshAdminReports().catch(handleError);
    },
    handleError
  );
}

function renderAdminBars() {
  $("totalBares").textContent =
    adminBars.length;

  $("totalAtivos").textContent =
    adminBars.filter(
      bar => bar.status === "ativo"
    ).length;

  $("barsTable").innerHTML = adminBars.map(bar => `
    <tr>
      <td>
        <b>${safe(bar.nome)}</b><br>
        <small>${safe(bar.id)}</small>
      </td>

      <td>
        <span class="tag ${
          bar.status === "ativo"
            ? "active"
            : "blocked"
        }">
          ${
            bar.status === "ativo"
              ? "Ativo"
              : "Bloqueado"
          }
        </span>
      </td>

      <td>
        <button
          class="btn ${
            bar.status === "ativo"
              ? "danger"
              : "success"
          }"
          data-toggle="${safe(bar.id)}"
        >
          ${
            bar.status === "ativo"
              ? "Bloquear"
              : "Liberar"
          }
        </button>
      </td>
    </tr>
  `).join("");
}

// =============================================
// BLOQUEAR E DESBLOQUEAR
// =============================================

$("barsTable").addEventListener(
  "click",
  async event => {
    const button = event.target.closest(
      "[data-toggle]"
    );

    if (!button) return;

    const bar = adminBars.find(
      b => b.id === button.dataset.toggle
    );

    if (!bar) return;

    const novoStatus =
      bar.status === "ativo"
        ? "bloqueado"
        : "ativo";

    if (!confirm(
      `Alterar ${bar.nome} para ${novoStatus}?`
    )) return;

    try {
      await updateDoc(
        doc(db, "bares", bar.id),
        { status: novoStatus }
      );

      toast("Status atualizado.");
    } catch (error) {
      handleError(error);
    }
  }
);

// =============================================
// CADASTRAR ESTABELECIMENTO
// =============================================

$("barForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const nome = $("barName").value.trim();
    const uid = $("barUid").value.trim();

    if (!nome || !uid) return;

    try {
      const reference = doc(
        db,
        "bares",
        uid
      );

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
  }
);

// =============================================
// RELATÓRIOS ADMINISTRATIVOS
// =============================================

async function refreshAdminReports() {
  const results = await Promise.all(
    adminBars.map(async bar => {
      const snapshot = await getDocs(
        collection(
          db,
          "bares",
          bar.id,
          "rodadas"
        )
      );

      return snapshot.docs.map(d => ({
        id: d.id,
        barName: bar.nome,
        ...d.data()
      }));
    })
  );

  const allRounds = results.flat();

  allRounds.sort((a, b) =>
    (b.criadoEm?.seconds || 0) -
    (a.criadoEm?.seconds || 0)
  );

  let total = 0;
  let commission = 0;

  $("adminRoundsTable").innerHTML =
    allRounds.map(round => {
      const count =
        (round.numeros || []).length;

      const revenue =
        count * round.precoCentavos;

      const fee =
        Math.round(revenue * 0.05);

      total += revenue;
      commission += fee;

      return `
        <tr>
          <td>${safe(round.barName)}</td>
          <td>${safe(round.nome)}</td>

          <td>
            ${
              round.status === "encerrada"
                ? "Encerrada"
                : "Aberta"
            }
          </td>

          <td>${count}</td>
          <td>${money(revenue)}</td>
          <td>${money(fee)}</td>
          <td>${round.resultado ?? "—"}</td>
        </tr>
      `;
    }).join("");

  $("totalArrecadacao").textContent =
    money(total);

  $("totalComissao").textContent =
    money(commission);
}

// =============================================
// REFERÊNCIAS DAS RODADAS
// =============================================

function roundsCollection() {
  return collection(
    db,
    "bares",
    user.uid,
    "rodadas"
  );
}

function roundReference(id) {
  return doc(
    db,
    "bares",
    user.uid,
    "rodadas",
    id
  );
}

// =============================================
// ATUALIZAÇÃO DAS RODADAS
// =============================================

function startBarRounds() {
  unsubscribeRounds = onSnapshot(
    roundsCollection(),
    snapshot => {
      rounds = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      rounds.sort((a, b) =>
        (b.criadoEm?.seconds || 0) -
        (a.criadoEm?.seconds || 0)
      );

      renderRounds();
      renderBarStats();

      if (selectedRoundId) {
        renderRoundDetail();
      }
    },
    handleError
  );
}

// =============================================
// CRIAR RODADA DEMONSTRATIVA
// =============================================

$("roundForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const nome =
      $("roundName").value.trim();

    const preco =
      Number($("roundPrice").value);

    const precoCentavos =
      Math.round(preco * 100);

    if (
      !nome ||
      !Number.isFinite(preco) ||
      preco <= 0 ||
      preco > 1000
    ) {
      toast("Informe um nome e valor fictício válido.");
      return;
    }

    try {
      await addDoc(
        roundsCollection(),
        {
          nome,
          precoCentavos,
          numeros: [],
          status: "aberta",
          resultado: null,
          criadoEm: serverTimestamp()
        }
      );

      $("roundForm").reset();

      toast("Rodada demonstrativa criada.");
    } catch (error) {
      handleError(error);
    }
  }
);

// =============================================
// LISTAGEM DAS RODADAS
// =============================================

function renderRounds() {
  $("roundsList").innerHTML =
    rounds.length
      ? rounds.map(round => `
        <div class="round-item">
          <div>
            <h3>${safe(round.nome)}</h3>

            <p>
              ${round.numeros?.length || 0}/100 registrados •
              ${
                round.status === "aberta"
                  ? "Aberta"
                  : "Encerrada"
              }
            </p>
          </div>

          <button
            class="btn secondary"
            data-round="${safe(round.id)}"
          >
            Visualizar
          </button>
        </div>
      `).join("")
      : "<p>Nenhuma rodada criada.</p>";
}

// =============================================
// ABRIR RODADA
// =============================================

$("roundsList").addEventListener(
  "click",
  event => {
    const button = event.target.closest(
      "[data-round]"
    );

    if (!button) return;

    selectedRoundId =
      button.dataset.round;

    selectedNumbers.clear();

    $("roundDetail").classList.remove(
      "hidden"
    );

    renderRoundDetail();

    $("roundDetail").scrollIntoView({
      behavior: "smooth"
    });
  }
);

// =============================================
// FECHAR RODADA
// =============================================

$("closeDetail").addEventListener(
  "click",
  () => {
    selectedRoundId = null;

    selectedNumbers.clear();

    $("roundDetail").classList.add(
      "hidden"
    );
  }
);

// =============================================
// ESTATÍSTICAS DO BAR
// =============================================

function renderBarStats() {
  const count = rounds.reduce(
    (sum, r) =>
      sum + (r.numeros?.length || 0),
    0
  );

  const revenue = rounds.reduce(
    (sum, r) =>
      sum +
      (r.numeros?.length || 0) *
      r.precoCentavos,
    0
  );

  $("barTotalRounds").textContent =
    rounds.length;

  $("barNumbers").textContent =
    count;

  $("barRevenue").textContent =
    money(revenue);

  $("barCommission").textContent =
    money(
      rounds.reduce(
        (sum, r) =>
          sum +
          Math.round(
            (r.numeros?.length || 0) *
            r.precoCentavos *
            0.05
          ),
        0
      )
    );
}

// =============================================
// EXIBIR DETALHES DA RODADA
// =============================================

function renderRoundDetail() {
  const round = rounds.find(
    r => r.id === selectedRoundId
  );

  if (!round) {
    $("roundDetail").classList.add(
      "hidden"
    );
    return;
  }

  const numeros = round.numeros || [];

  const used = new Map(
    numeros.map(n => [
      n.numero,
      n.nome
    ])
  );

  const closed =
    round.status === "encerrada";

  // Remove da seleção os números
  // que ficaram ocupados.
  for (const numero of selectedNumbers) {
    if (used.has(numero) || closed) {
      selectedNumbers.delete(numero);
    }
  }

  $("selectedRoundTitle").textContent =
    round.nome;

  // GRADE COM 100 NÚMEROS

  $("numberGrid").innerHTML =
    Array.from(
      { length: 100 },
      (_, index) => {
        const numero = index + 1;

        const taken =
          used.has(numero);

        const chosen =
          selectedNumbers.has(numero);

        return `
          <button
            type="button"
            class="number ${
              taken ? "taken" : ""
            } ${
              chosen ? "chosen" : ""
            }"
            data-number="${numero}"
            ${
              taken || closed
                ? "disabled"
                : ""
            }
            title="${
              taken
                ? safe(used.get(numero))
                : "Disponível"
            }"
          >
            ${String(numero).padStart(2, "0")}
          </button>
        `;
      }
    ).join("");

  const revenue =
    numeros.length * round.precoCentavos;

  $("roundCount").textContent =
    numeros.length;

  $("roundRevenue").textContent =
    money(revenue);

  $("roundPrize").textContent =
    money(Math.round(revenue * 0.50));

  $("roundFee").textContent =
    money(Math.round(revenue * 0.05));

  $("numberForm").classList.toggle(
    "hidden",
    closed
  );

  $("drawButton").disabled =
    closed || numeros.length === 0;

  $("roundResult").textContent =
    closed
      ? `Resultado demonstrativo: número ${round.resultado}`
      : "Rodada aberta";

  updateSelection();
}

// =============================================
// SELECIONAR VÁRIOS NÚMEROS
// =============================================

$("numberGrid").addEventListener(
  "click",
  event => {
    const button = event.target.closest(
      "[data-number]"
    );

    if (!button || button.disabled) {
      return;
    }

    const numero =
      Number(button.dataset.number);

    if (selectedNumbers.has(numero)) {
      selectedNumbers.delete(numero);
    } else {
      if (selectedNumbers.size >= MAX_SELECTION) {
        toast(
          `Selecione no máximo ${MAX_SELECTION} números.`
        );
        return;
      }

      selectedNumbers.add(numero);
    }

    button.classList.toggle(
      "chosen",
      selectedNumbers.has(numero)
    );

    updateSelection();
  }
);

// =============================================
// LIMPAR SELEÇÃO
// =============================================

$("clearSelection").addEventListener(
  "click",
  () => {
    selectedNumbers.clear();
    renderRoundDetail();
  }
);

// =============================================
// REGISTRAR MÚLTIPLOS NÚMEROS
// =============================================

$("numberForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const nome =
      $("participantName").value.trim();

    const numerosEscolhidos =
      [...selectedNumbers].sort(
        (a, b) => a - b
      );

    if (!nome || nome.length > 80) {
      toast("Informe o nome do participante.");
      return;
    }

    if (
      !numerosEscolhidos.length ||
      numerosEscolhidos.length > MAX_SELECTION
    ) {
      toast("Selecione entre 1 e 20 números.");
      return;
    }

    const roundId = selectedRoundId;

    try {
      const barRef = doc(
        db,
        "bares",
        user.uid
      );

      const ref =
        roundReference(roundId);

      await runTransaction(
        db,
        async transaction => {
          const barSnap =
            await transaction.get(barRef);

          const snapshot =
            await transaction.get(ref);

          if (
            barSnap.data()?.status !== "ativo"
          ) {
            throw new Error(
              "Estabelecimento bloqueado."
            );
          }

          if (!snapshot.exists()) {
            throw new Error(
              "Rodada não encontrada."
            );
          }

          const data = snapshot.data();

          const existentes =
            data.numeros || [];

          if (data.status !== "aberta") {
            throw new Error(
              "Rodada encerrada."
            );
          }

          const ocupados = new Set(
            existentes.map(
              item => item.numero
            )
          );

          if (
            numerosEscolhidos.some(
              numero => ocupados.has(numero)
            )
          ) {
            throw new Error(
              "Um dos números selecionados já foi registrado."
            );
          }

          if (
            existentes.length +
            numerosEscolhidos.length > 100
          ) {
            throw new Error(
              "A rodada excederia 100 números."
            );
          }

          const novos =
            numerosEscolhidos.map(
              numero => ({
                numero,
                nome
              })
            );

          transaction.update(ref, {
            numeros: [
              ...existentes,
              ...novos
            ]
          });
        }
      );

      selectedNumbers.clear();

      $("numberForm").reset();

      renderRoundDetail();

      toast(
        "Números demonstrativos registrados!"
      );

    } catch (error) {
      handleError(error);
    }
  }
);

// =============================================
// SIMULAR RESULTADO
// =============================================

$("drawButton").addEventListener(
  "click",
  async () => {
    if (!selectedRoundId) return;

    if (!confirm(
      "Encerrar e simular o resultado desta rodada?"
    )) {
      return;
    }

    try {
      const barRef = doc(
        db,
        "bares",
        user.uid
      );

      const ref =
        roundReference(selectedRoundId);

      await runTransaction(
        db,
        async transaction => {
          const barSnap =
            await transaction.get(barRef);

          const snapshot =
            await transaction.get(ref);

          if (
            barSnap.data()?.status !== "ativo"
          ) {
            throw new Error(
              "Estabelecimento bloqueado."
            );
          }

          if (!snapshot.exists()) {
            throw new Error(
              "Rodada não encontrada."
            );
          }

          const data =
            snapshot.data();

          if (data.status !== "aberta") {
            throw new Error(
              "Rodada encerrada."
            );
          }

          const numeros =
            data.numeros || [];

          if (!numeros.length) {
            throw new Error(
              "Não há números registrados."
            );
          }

          // Apenas simulação.
          const limite =
            Math.floor(
              4294967296 / numeros.length
            ) * numeros.length;

          const bytes =
            new Uint32Array(1);

          let valor;

          do {
            crypto.getRandomValues(bytes);
            valor = bytes[0];
          } while (valor >= limite);

          const indice =
            valor % numeros.length;

          transaction.update(ref, {
            status: "encerrada",
            resultado:
              numeros[indice].numero
          });
        }
      );

      selectedNumbers.clear();

      toast("Simulação concluída.");

    } catch (error) {
      handleError(error);
    }
  }
);
