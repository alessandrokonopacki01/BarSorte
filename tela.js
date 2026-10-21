
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// =========================================
// FIREBASE - MESMO PROJETO DO BARSORTE
// =========================================

const firebaseConfig = {
  apiKey: "AIzaSyD6SCD044JZ2Wvc5u6gu2tPfsgBgwUYKkk",
  authDomain: "barsorte-b8d5a.firebaseapp.com",
  projectId: "barsorte-b8d5a",
  storageBucket: "barsorte-b8d5a.firebasestorage.app",
  messagingSenderId: "805597809047",
  appId: "1:805597809047:web:b85f71837b992b752edcd2",
  measurementId: "G-556D60HG9R"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = id => document.getElementById(id);

const params = new URLSearchParams(window.location.search);

const barId = params.get("bar");
const rodadaId = params.get("rodada");

let unsubscribeRound = null;
let unsubscribeBar = null;
let currentRound = null;
let currentBarActive = false;
let lastResult = null;
let overlayDismissedFor = null;

// =========================================
// FUNÇÕES AUXILIARES
// =========================================

function money(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function message(title, text) {
  $("messageTitle").textContent = title;
  $("messageText").textContent = text;
  $("messageBox").classList.remove("hidden");
}

function hideMessage() {
  $("messageBox").classList.add("hidden");
}

function setConnection(text) {
  $("connection").textContent = text;
}

function stopRoundListener() {
  unsubscribeRound?.();
  unsubscribeRound = null;
  currentRound = null;
}

// =========================================
// GRADE INICIAL
// =========================================

function renderGrid(occupied = new Set(), winner = null) {
  const fragment = document.createDocumentFragment();

  for (let n = 1; n <= 100; n++) {
    const element = document.createElement("div");

    element.className = "number";

    if (occupied.has(n)) {
      element.classList.add("taken");
    }

    if (winner === n) {
      element.classList.add("winner");
    }

    element.textContent = String(n).padStart(2, "0");

    fragment.appendChild(element);
  }

  $("numbersGrid").replaceChildren(fragment);
}

renderGrid();

// =========================================
// RENDERIZAR RODADA
// =========================================

function renderRound(round) {
  currentRound = round;

  const numbers = Array.isArray(round.numeros)
    ? round.numeros
    : [];

  // Somente os números são utilizados.
  // Não exibimos nome, WhatsApp ou Pix.
  const occupied = new Set(
    numbers.map(item => Number(item.numero))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 100)
  );

  const closed = round.status === "encerrada";
  const result = closed ? Number(round.resultado) : null;

  const validResult =
    Number.isInteger(result) &&
    occupied.has(result);

  const total = occupied.size * Number(round.precoCentavos || 0);
  const prize = Math.round(total * 0.5);

  $("roundName").textContent = round.nome || "Rodada";
  $("soldCount").textContent = occupied.size;
  $("freeCount").textContent = 100 - occupied.size;
  $("revenue").textContent = money(total);
  $("prize").textContent = money(prize);

  $("roundStatus").textContent =
    closed ? "Rodada encerrada" : "Rodada em andamento";

  renderGrid(occupied, validResult ? result : null);

  if (validResult) {
    $("winnerNumber").textContent =
      String(result).padStart(3, "0");

    if (lastResult !== result) {
      overlayDismissedFor = null;
    }

    if (overlayDismissedFor !== result) {
      $("winnerOverlay").classList.remove("hidden");
    }
  } else {
    $("winnerOverlay").classList.add("hidden");
    overlayDismissedFor = null;
  }

  lastResult = validResult ? result : null;
}

// =========================================
// ACOMPANHAR RODADA EM TEMPO REAL
// =========================================

function startRoundListener() {
  if (unsubscribeRound || !currentBarActive) return;

  const ref = doc(
    db,
    "bares",
    barId,
    "rodadas",
    rodadaId
  );

  unsubscribeRound = onSnapshot(
    ref,
    snapshot => {
      if (!snapshot.exists()) {
        message(
          "Rodada não encontrada",
          "Confira o endereço da tela e selecione outra rodada."
        );
        return;
      }

      renderRound(snapshot.data());
      hideMessage();

      setConnection(
        snapshot.metadata.fromCache
          ? "Dados locais"
          : "● Conectado"
      );
    },
    error => {
      console.error(error);
      stopRoundListener();

      setConnection("Desconectado");

      message(
        "Não foi possível carregar a rodada",
        "Confira o login, as permissões e a conexão com a internet."
      );
    }
  );
}

// =========================================
// VALIDAR ESTABELECIMENTO E LOGIN
// =========================================

if (!barId || !rodadaId) {
  message(
    "Endereço incompleto",
    "Abra a tela pelo botão do painel do estabelecimento."
  );
} else {
  onAuthStateChanged(auth, user => {
    unsubscribeBar?.();
    unsubscribeBar = null;
    stopRoundListener();
    currentBarActive = false;

    if (!user) {
      setConnection("Login necessário");

      message(
        "Acesso não autenticado",
        "Entre no BarSorte com a conta do estabelecimento antes de abrir esta tela."
      );
      return;
    }

    if (user.uid !== barId) {
      setConnection("Acesso negado");

      message(
        "Conta incorreta",
        "Esta tela deve ser aberta com a conta do estabelecimento responsável pela rodada."
      );
      return;
    }

    unsubscribeBar = onSnapshot(
      doc(db, "bares", barId),
      snapshot => {
        if (!snapshot.exists() ||
            snapshot.data().status !== "ativo") {
          currentBarActive = false;
          stopRoundListener();

          $("winnerOverlay").classList.add("hidden");
          setConnection("Acesso suspenso");

          message(
            "Acesso suspenso",
            "O estabelecimento está bloqueado ou não está cadastrado."
          );
          return;
        }

        currentBarActive = true;
        startRoundListener();
      },
      error => {
        console.error(error);
        currentBarActive = false;
        stopRoundListener();

        message(
          "Erro de permissão",
          "Não foi possível verificar o estabelecimento."
        );
      }
    );
  });
}

// =========================================
// CONTROLES DA TV
// =========================================

$("fullscreen").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error(error);
  }
});

$("closeWinner").addEventListener("click", () => {
  if (lastResult !== null) {
    overlayDismissedFor = lastResult;
  }

  $("winnerOverlay").classList.add("hidden");
});
