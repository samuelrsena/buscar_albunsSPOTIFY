const CONFIG = {
  clientId: "584f712206474980b6a131b58d87356b",
  redirectUri: "http://127.0.0.1:5500/",
  apiUrl: "https://api.spotify.com/v1",
  authUrl: "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  searchLimit: 10,
  albumsLimit: 10,
};

const STORAGE = {
  token: "token",
  verifier: "verifier",
};

const ELEMENT_IDS = {
  loginBtn: "login-btn",
  form: "search-form",
  input: "artist-input",
  status: "status",
  artists: "artists",
  albumsTitle: "albums-title",
  filters: "filters",
  typeFilter: "filter-type",
  sortFilter: "filter-sort",
  albums: "albums",
};

const el = {};
const missingIds = [];

for (const [key, id] of Object.entries(ELEMENT_IDS)) {
  el[key] = document.getElementById(id);
  if (!el[key]) missingIds.push(id);
}

if (missingIds.length) {
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<p style="color:#ff6b6b;padding:16px">IDs ausentes no HTML: ${missingIds.join(", ")}</p>`
  );
  throw new Error(`IDs ausentes no HTML: ${missingIds.join(", ")}`);
}

const DEFAULT_FILTERS = {
  type: "all",
  sort: "year-desc",
};

const state = {
  token: null,
  albums: [],
  artistName: "",
};

const Auth = {
  randomString(length = 64) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (v) => chars[v % chars.length]).join("");
  },

  async sha256Base64Url(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  },

  async login() {
    const verifier = this.randomString();
    sessionStorage.setItem(STORAGE.verifier, verifier);

    const params = new URLSearchParams({
      client_id: CONFIG.clientId,
      response_type: "code",
      redirect_uri: CONFIG.redirectUri,
      code_challenge_method: "S256",
      code_challenge: await this.sha256Base64Url(verifier),
    });

    location.href = `${CONFIG.authUrl}?${params}`;
  },

  async handleCallback() {
    const query = new URLSearchParams(location.search);
    const code = query.get("code");
    const error = query.get("error");

    if (!code && !error) return;

    history.replaceState({}, "", CONFIG.redirectUri);

    if (error) throw new Error("Login cancelado ou negado.");

    const response = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CONFIG.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: CONFIG.redirectUri,
        code_verifier: sessionStorage.getItem(STORAGE.verifier),
      }),
    });

    const data = await response.json();

    if (!data.access_token) {
      throw new Error("Não foi possível obter o token de acesso.");
    }

    sessionStorage.setItem(STORAGE.token, data.access_token);
  },

  getToken() {
    return sessionStorage.getItem(STORAGE.token);
  },

  clear() {
    sessionStorage.removeItem(STORAGE.token);
    sessionStorage.removeItem(STORAGE.verifier);
    state.token = null;
  },
};

const Api = {
  async request(path) {
    const url = path.startsWith("http") ? path : CONFIG.apiUrl + path;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${state.token}` },
    });

    if (response.status === 401) {
      Auth.clear();
      UI.showLogin();
      throw new Error("Sessão expirada. Entre novamente.");
    }

    if (!response.ok) {
      throw new Error(`Erro ${response.status} na API do Spotify.`);
    }

    return response.json();
  },

  async searchArtists(name) {
    const query = encodeURIComponent(name);
    const data = await this.request(
      `/search?q=${query}&type=artist&limit=${CONFIG.searchLimit}`
    );
    return data.artists.items;
  },

  async getAllAlbums(artistId) {
    let path = `/artists/${artistId}/albums?include_groups=album,single&limit=${CONFIG.albumsLimit}`;
    const albums = [];

    while (path) {
      const data = await this.request(path);
      albums.push(...data.items);
      path = data.next;
    }

    return removeDuplicates(albums);
  },
};

function removeDuplicates(albums) {
  const seen = new Set();

  return albums.filter((album) => {
    const key = `${album.name.toLowerCase()}|${album.album_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const compareNames = (a, b) =>
  a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });

const SORTERS = {
  "year-desc": (a, b) =>
    b.release_date.localeCompare(a.release_date) || compareNames(a, b),
  "year-asc": (a, b) =>
    a.release_date.localeCompare(b.release_date) || compareNames(a, b),
  "name-asc": (a, b) => compareNames(a, b),
  "name-desc": (a, b) => compareNames(b, a),
};

function filterAlbums(albums, { type, sort }) {
  return albums
    .filter((album) => type === "all" || album.album_type === type)
    .sort(SORTERS[sort]);
}

const UI = {
  escape(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(text).replace(/[&<>"']/g, (char) => map[char]);
  },

  setStatus(message = "") {
    el.status.textContent = message;
  },

  showLogin() {
    el.loginBtn.hidden = false;
    el.form.hidden = true;
  },

  showSearch() {
    el.loginBtn.hidden = true;
    el.form.hidden = false;
  },

  clearResults() {
    el.artists.innerHTML = "";
    el.albums.innerHTML = "";
    el.albumsTitle.hidden = true;
    el.filters.hidden = true;
  },

  resetFilters() {
    el.typeFilter.value = DEFAULT_FILTERS.type;
    el.sortFilter.value = DEFAULT_FILTERS.sort;
  },

  getFilters() {
    return {
      type: el.typeFilter.value,
      sort: el.sortFilter.value,
    };
  },

  artistCard(artist) {
    const image = artist.images[0]
      ? `<img src="${artist.images[0].url}" alt="">`
      : "";

    return `
      <div class="card" data-id="${artist.id}" data-name="${this.escape(artist.name)}">
        ${image}
        <strong>${this.escape(artist.name)}</strong>
      </div>`;
  },

  albumCard(album) {
    const image = album.images[0]
      ? `<img src="${album.images[0].url}" alt="">`
      : "";
    const year = album.release_date.slice(0, 4);
    const type = album.album_type === "single" ? "single" : "álbum";

    return `
      <a class="card" href="${album.external_urls.spotify}" target="_blank" rel="noopener">
        ${image}
        <strong>${this.escape(album.name)}</strong>
        <small>${year} · ${type} · ${album.total_tracks} faixas</small>
      </a>`;
  },

  renderArtists(artists) {
    this.clearResults();

    if (!artists.length) {
      this.setStatus("Nenhum artista encontrado.");
      return;
    }

    this.setStatus("Escolha o artista:");
    el.artists.innerHTML = artists.map((a) => this.artistCard(a)).join("");
  },

  renderAlbums(albums, artistName, total) {
    this.clearResults();

    el.albumsTitle.hidden = false;
    el.filters.hidden = false;
    el.albumsTitle.textContent = `${albums.length} de ${total} lançamentos de ${artistName}`;

    if (!albums.length) {
      this.setStatus("Nenhum lançamento com esse filtro.");
      return;
    }

    this.setStatus();
    el.albums.innerHTML = albums.map((a) => this.albumCard(a)).join("");
  },
};

function applyFilters() {
  const filtered = filterAlbums([...state.albums], UI.getFilters());
  UI.renderAlbums(filtered, state.artistName, state.albums.length);
}

async function run(task) {
  try {
    await task();
  } catch (error) {
    UI.setStatus(error.message);
  }
}

function handleSearch(event) {
  event.preventDefault();

  const name = el.input.value.trim();
  if (!name) return;

  run(async () => {
    UI.setStatus("Buscando...");
    const artists = await Api.searchArtists(name);
    UI.renderArtists(artists);
  });
}

function handleArtistClick(event) {
  const card = event.target.closest(".card");
  if (!card) return;

  const { id, name } = card.dataset;

  run(async () => {
    UI.setStatus("Carregando álbuns...");
    state.albums = await Api.getAllAlbums(id);
    state.artistName = name;
    UI.resetFilters();
    applyFilters();
  });
}

function bindEvents() {
  el.loginBtn.addEventListener("click", () => Auth.login());
  el.form.addEventListener("submit", handleSearch);
  el.artists.addEventListener("click", handleArtistClick);
  el.filters.addEventListener("change", applyFilters);
}

async function init() {
  bindEvents();

  try {
    await Auth.handleCallback();
  } catch (error) {
    UI.setStatus(error.message);
  }

  state.token = Auth.getToken();

  if (state.token) {
    UI.showSearch();
  } else {
    UI.showLogin();
  }

  if (CONFIG.clientId.startsWith("COLE_SEU")) {
    UI.setStatus("Troque COLE_SEU_CLIENT_ID_AQUI pelo seu Client ID no app.js.");
  }
}

init();

export {};