const API_URL =
  "https://il.srgssr.ch/integrationlayer/2.0/srf/songList/radio/byChannel/69e8ac16-4327-4af4-b873-fd5cd6e895a7";

const MAX_AUTO_NEXT_PAGES = 6;
const MIN_LOADER_TIME = 1000;
const LIVE_CHECK_INTERVAL = 5000;

const songCarousel    = document.querySelector("#songCarousel");
const loaderOverlay   = document.querySelector("#loaderOverlay");
const currentTitle    = document.querySelector("#currentTitle");
const currentArtist   = document.querySelector("#currentArtist");
const currentTime     = document.querySelector("#currentTime");
const liveTimer       = document.querySelector("#liveTimer");
const currentLinks    = document.querySelector("#currentLinks");
const timeInput       = document.querySelector("#timeInput");
const amountInput     = document.querySelector("#amountInput");
const modeSelect      = document.querySelector("#modeSelect");
const searchTimeBtn   = document.querySelector("#searchTimeBtn");
const resetSearchBtn  = document.querySelector("#resetSearchBtn");
const timeSearchResults = document.querySelector("#timeSearchResults");
const openHistoryBtn  = document.querySelector("#openHistoryBtn");
const historyList     = document.querySelector("#historyList");
const historyModal    = document.querySelector("#historyModal");
const searchModal     = document.querySelector("#searchModal");
const refreshBtn      = document.querySelector("#refreshBtn");
const statusText      = document.querySelector("#status");
const modeTooltip     = document.querySelector("#modeTooltip");
const audioAnimation  = document.querySelector("#audioAnimation");

let allSongs          = [];
let nextUrl           = null;
let currentSongKey    = "";
let liveTimerInterval = null;
let liveCheckInterval = null;

// ── Event Listeners ──────────────────────────────────────────────────────────

searchTimeBtn.addEventListener("click", searchSongsByTime);
resetSearchBtn.addEventListener("click", resetTimeSearch);
refreshBtn.addEventListener("click", loadInitialSongs);
modeSelect.addEventListener("change", updateModeDescription);

openHistoryBtn.addEventListener("click", function () {
  renderHistory();
  openModal(historyModal);
});

document.querySelectorAll("[data-close-modal]").forEach(function (button) {
  button.addEventListener("click", function () {
    closeModal(document.querySelector(`#${button.dataset.closeModal}`));
  });
});

document.querySelectorAll(".tooltip-icon").forEach(function (tooltip) {
  tooltip.addEventListener("click", function (event) {
    event.stopPropagation();
    tooltip.classList.toggle("active");
  });
});

document.addEventListener("click", function () {
  document.querySelectorAll(".tooltip-icon.active").forEach(function (tooltip) {
    tooltip.classList.remove("active");
  });
});

// ── Audio Animation ──────────────────────────────────────────────────────────

function showAudioAnimation() {
  audioAnimation?.classList.remove("is-hidden");
}

function hideAudioAnimation() {
  audioAnimation?.classList.add("is-hidden");
}

function animateAudioOut() {
  if (!audioAnimation) return;
  audioAnimation.classList.remove("audio-slide-in");
  audioAnimation.classList.add("audio-slide-out");
}

function animateAudioIn() {
  if (!audioAnimation) return;
  audioAnimation.classList.remove("audio-slide-out");
  audioAnimation.classList.add("audio-slide-in");
}

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadInitialSongs() {
  const loaderStartedAt = Date.now();

  try {
    showLoader(true);
    setStatus("Aktuelle Songdaten werden geladen...");

    const data  = await fetchSongData(API_URL);
    const songs = data.songList || [];

    if (songs.length === 0) {
      throw new Error("Es wurden keine Songs gefunden.");
    }

    allSongs = songs;
    nextUrl  = getNextUrl(data);

    await updateCurrentDisplayFromSongs(songs, true);

    setStatus("Ältere Songs werden automatisch nachgeladen...");
    await preloadOlderSongs(MAX_AUTO_NEXT_PAGES);

    startLiveCheck();
    setStatus(`Bereit. ${allSongs.length} Songs geladen. Zuletzt aktualisiert: ${getCurrentTime()}`);
  } catch (error) {
    showError(error.message);
    console.error(error);
  } finally {
    await keepLoaderVisible(loaderStartedAt);
    showLoader(false);
  }
}

async function fetchSongData(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API-Fehler: ${response.status}`);
  }

  return response.json();
}

function getNextUrl(data) {
  if (!data.next) return null;
  if (typeof data.next === "string") return data.next;
  return data.next.href || data.next.url || null;
}

async function preloadOlderSongs(maxPages) {
  let loadedPages = 0;

  while (nextUrl && loadedPages < maxPages) {
    const data = await fetchSongData(nextUrl);
    addUniqueSongs(data.songList || []);
    nextUrl = getNextUrl(data);
    loadedPages++;
  }
}

// ── Live Check ───────────────────────────────────────────────────────────────

function startLiveCheck() {
  stopLiveCheck();
  liveCheckInterval = setInterval(checkNowPlaying, LIVE_CHECK_INTERVAL);
}

function stopLiveCheck() {
  if (liveCheckInterval) {
    clearInterval(liveCheckInterval);
    liveCheckInterval = null;
  }
}

async function checkNowPlaying() {
  try {
    const data  = await fetchSongData(API_URL);
    const songs = data.songList || [];

    if (songs.length === 0) return;

    mergeNewestSongs(songs);
    await updateCurrentDisplayFromSongs(songs, false);
    setStatus(`Live geprüft: ${getCurrentTime()}`);
  } catch (error) {
    console.error("Live-Check fehlgeschlagen:", error);
  }
}

function mergeNewestSongs(newSongs) {
  newSongs.forEach(function (newSong) {
    const index = allSongs.findIndex(
      (s) => s.date === newSong.date && s.title === newSong.title
    );

    if (index === -1) {
      allSongs.unshift(newSong);
    } else {
      allSongs[index] = { ...allSongs[index], ...newSong };
    }
  });
}

function addUniqueSongs(newSongs) {
  newSongs.forEach(function (newSong) {
    const alreadyExists = allSongs.some(
      (s) => s.date === newSong.date && s.title === newSong.title
    );
    if (!alreadyExists) allSongs.push(newSong);
  });
}

// ── Display / Carousel ───────────────────────────────────────────────────────

async function updateCurrentDisplayFromSongs(songs, forceUpdate) {
  const currentSong = songs.find((song) => song.isPlayingNow);

  if (currentSong) {
    const info       = getSongInfo(currentSong);
    const newSongKey = `${info.title}-${info.artist}-${info.date}`;

    if (!forceUpdate && newSongKey === currentSongKey) return;

    await renderCurrentSongWithCarousel(info, newSongKey);
    startElapsedTimer(info);
    return;
  }

  const latestInfo = getSongInfo(songs[0]);
  const noSongKey  = `no-song-${latestInfo.title}-${latestInfo.artist}-${latestInfo.date}-${latestInfo.duration}`;

  if (!forceUpdate && noSongKey === currentSongKey) return;

  await renderNoSongWithCarousel(latestInfo, noSongKey);
  startNoSongTimer(latestInfo);
}

async function renderCurrentSongWithCarousel(info, newSongKey) {
  if (!currentSongKey) {
    showAudioAnimation();
    updateCurrentSongContent(info);
    currentSongKey = newSongKey;
    return;
  }

  songCarousel.classList.replace("slide-in", "slide-out") ||
    songCarousel.classList.add("slide-out");
  animateAudioOut();

  await wait(550);

  updateCurrentSongContent(info);
  songCarousel.classList.replace("slide-out", "slide-in") ||
    songCarousel.classList.add("slide-in");
  animateAudioIn();

  await wait(650);

  songCarousel.classList.remove("slide-in");
  currentSongKey = newSongKey;
}

async function renderNoSongWithCarousel(latestInfo, newSongKey) {
  if (!currentSongKey) {
    hideAudioAnimation();
    updateNoSongContent(latestInfo);
    currentSongKey = newSongKey;
    return;
  }

  songCarousel.classList.replace("slide-in", "slide-out") ||
    songCarousel.classList.add("slide-out");

  await wait(550);

  updateNoSongContent(latestInfo);
  songCarousel.classList.replace("slide-out", "slide-in") ||
    songCarousel.classList.add("slide-in");

  await wait(650);

  songCarousel.classList.remove("slide-in");
  currentSongKey = newSongKey;
}

function updateCurrentSongContent(info) {
  currentTitle.textContent  = info.title;
  currentArtist.textContent = info.artist;
  currentTime.textContent   = info.date
    ? `Gestartet um ${formatSongTime(info.date)} Uhr`
    : "";
  renderLinks(currentLinks, info.title, info.artist);
}

function updateNoSongContent(latestInfo) {
  currentTitle.textContent  = "Aktuell kein Song gemeldet";
  currentArtist.textContent = "Vermutlich Moderation, Nachrichten oder Beitrag";
  currentTime.textContent   = latestInfo.date
    ? `Letzter Song: ${latestInfo.title} – ${latestInfo.artist}, ${formatSongTime(latestInfo.date)} Uhr`
    : "";
  liveTimer.textContent    = "";
  currentLinks.innerHTML   = "";
}

// ── Timers ───────────────────────────────────────────────────────────────────

function startElapsedTimer(info) {
  clearLiveTimer();
  updateElapsedTimer(info);
  liveTimerInterval = setInterval(() => updateElapsedTimer(info), 1000);
}

function updateElapsedTimer(info) {
  if (!info.date) {
    liveTimer.textContent = "";
    return;
  }

  const elapsed = Date.now() - new Date(info.date).getTime();

  if (elapsed < 0) {
    liveTimer.textContent = "Läuft seit 00:00 Min.";
    return;
  }

  liveTimer.textContent = `Läuft seit ${formatElapsed(elapsed)} Min.`;
}

function startNoSongTimer(latestInfo) {
  clearLiveTimer();
  updateNoSongTimer(latestInfo);
  liveTimerInterval = setInterval(() => updateNoSongTimer(latestInfo), 1000);
}

function updateNoSongTimer(latestInfo) {
  if (!latestInfo.date) {
    liveTimer.textContent = "";
    return;
  }

  const songStart     = new Date(latestInfo.date).getTime();
  const referenceTime = latestInfo.duration ? songStart + latestInfo.duration : songStart;
  const elapsed       = Date.now() - referenceTime;

  if (elapsed < 0) {
    liveTimer.textContent = "Letzter Song läuft rechnerisch noch";
    return;
  }

  liveTimer.textContent = `Seit ${formatElapsed(elapsed)} Min. kein laufender Song gemeldet`;
}

function clearLiveTimer() {
  if (liveTimerInterval) {
    clearInterval(liveTimerInterval);
    liveTimerInterval = null;
  }
}

/** Converts a millisecond duration to a "MM:SS" string. */
function formatElapsed(ms) {
  const total   = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ── Time Search ──────────────────────────────────────────────────────────────

function updateModeDescription() {
  const descriptions = {
    center: "Zeigt den Song, der zur gewählten Uhrzeit lief, sowie die umliegenden Songs.",
    after:  "Zeigt den Song, der zur gewählten Uhrzeit lief, sowie die darauffolgenden Songs.",
    before: "Zeigt die Songs bis einschliesslich des Songs, der zur gewählten Uhrzeit lief."
  };
  modeTooltip.textContent = descriptions[modeSelect.value];
}

function searchSongsByTime() {
  timeSearchResults.innerHTML = "";

  if (!timeInput.value) {
    showSearchMessage("Bitte eine Uhrzeit eingeben.", true, timeSearchResults);
    openModal(searchModal);
    return;
  }

  if (allSongs.length === 0) {
    showSearchMessage("Es sind noch keine Songdaten geladen.", true, timeSearchResults);
    openModal(searchModal);
    return;
  }

  const amount       = clampNumber(parseInt(amountInput.value), 1, 20);
  const mode         = modeSelect.value;
  const sortedSongs  = getSongsOldestFirst().filter((song) => song.date);
  const newestSong   = getSongsNewestFirst()[0];
  const targetTime   = createTargetDate(newestSong.date, timeInput.value);

  if (targetTime > new Date(newestSong.date)) {
    showSearchMessage(
      "Für diese Uhrzeit liegen heute noch keine Songdaten vor.",
      true,
      timeSearchResults
    );
    openModal(searchModal);
    return;
  }

  const playingIndex  = findSongPlayingAtTime(sortedSongs, targetTime);
  const centerIndex   = playingIndex !== -1
    ? playingIndex
    : findClosestSongIndex(sortedSongs, targetTime);

  let results;

  if (mode === "center") {
    results = getCenteredSongs(sortedSongs, centerIndex, amount);
  } else if (mode === "after") {
    results = sortedSongs.slice(centerIndex, centerIndex + amount);
  } else {
    // mode === "before"
    const endIndex   = centerIndex + 1;
    const startIndex = Math.max(0, endIndex - amount);
    results = sortedSongs.slice(startIndex, endIndex);
  }

  renderTimeSearchResults(results, sortedSongs[centerIndex]);
  openModal(searchModal);
}

function findSongPlayingAtTime(songs, targetTime) {
  const target = targetTime.getTime();

  return songs.findIndex(function (song) {
    if (!song.date || !song.duration) return false;

    const songStart = new Date(song.date).getTime();
    return songStart <= target && target < songStart + Number(song.duration);
  });
}

function getCenteredSongs(songs, centerIndex, amount) {
  let start = centerIndex - Math.floor(amount / 2);
  let end   = start + amount;

  if (start < 0) {
    start = 0;
    end   = amount;
  }

  if (end > songs.length) {
    end   = songs.length;
    start = Math.max(0, end - amount);
  }

  return songs.slice(start, end);
}

function resetTimeSearch() {
  timeInput.value    = "";
  amountInput.value  = 5;
  modeSelect.value   = "center";
  updateModeDescription();
  timeSearchResults.innerHTML = "";
  closeModal(searchModal);
  setStatus("Suche zurückgesetzt.");
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderTimeSearchResults(results, highlightSong) {
  timeSearchResults.innerHTML = "";

  if (results.length === 0) {
    showSearchMessage("Keine passenden Songs gefunden.", true, timeSearchResults);
    return;
  }

  results.forEach(function (song, index) {
    const isHighlight =
      highlightSong &&
      song.date  === highlightSong.date &&
      song.title === highlightSong.title;

    timeSearchResults.appendChild(createSongItem(song, isHighlight, index));
  });
}

function renderHistory() {
  historyList.innerHTML = "";
  getSongsNewestFirst().forEach(function (song, index) {
    historyList.appendChild(createSongItem(song, false, index));
  });
}

function createSongItem(song, isHighlight, index = 0) {
  const info = getSongInfo(song);

  const item = document.createElement("article");
  item.classList.add("song-item");
  item.style.animationDelay = `${index * 60}ms`;

  if (isHighlight) item.classList.add("highlight");

  const title  = document.createElement("strong");
  title.textContent = `${formatSongTime(info.date)} · ${info.title}`;

  const artist = document.createElement("span");
  artist.textContent = info.artist;

  const links = document.createElement("div");
  links.classList.add("links");
  renderLinks(links, info.title, info.artist);

  item.append(title, artist, links);

  return item;
}

function renderLinks(container, title, artist) {
  const query = encodeURIComponent(`${artist} ${title}`);

  const youtubeLink = document.createElement("a");
  youtubeLink.classList.add("youtube");
  youtubeLink.href    = `https://www.youtube.com/results?search_query=${query}`;
  youtubeLink.target  = "_blank";
  youtubeLink.rel     = "noopener noreferrer";
  youtubeLink.textContent = "YouTube";

  const spotifyLink = document.createElement("a");
  spotifyLink.classList.add("spotify");
  spotifyLink.href    = `https://open.spotify.com/search/${query}`;
  spotifyLink.target  = "_blank";
  spotifyLink.rel     = "noopener noreferrer";
  spotifyLink.textContent = "Spotify";

  // Replace content in one shot instead of innerHTML = "" + two appends
  container.replaceChildren(youtubeLink, spotifyLink);
}

// ── Modal ────────────────────────────────────────────────────────────────────

function openModal(modal) {
  modal.classList.remove("hidden");
  requestAnimationFrame(() => modal.classList.add("open"));
}

function closeModal(modal) {
  modal.classList.remove("open");
  setTimeout(() => modal.classList.add("hidden"), 650);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTargetDate(referenceDateString, timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  const targetDate       = new Date(referenceDateString);

  targetDate.setHours(hours, minutes, 0, 0);

  return targetDate;
}

function findClosestSongIndex(songs, targetTime) {
  let closestIndex      = 0;
  let smallestDifference = Infinity;

  songs.forEach(function (song, index) {
    const difference = Math.abs(new Date(song.date) - targetTime);

    if (difference < smallestDifference) {
      smallestDifference = difference;
      closestIndex       = index;
    }
  });

  return closestIndex;
}

function getSongsOldestFirst() {
  return [...allSongs].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getSongsNewestFirst() {
  return [...allSongs].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function getSongInfo(song) {
  return {
    title:        song.title || "Unbekannter Titel",
    artist:       song.artist?.name || "Unbekannter Interpret",
    date:         song.date || null,
    duration:     Number(song.duration) || null,
    isPlayingNow: song.isPlayingNow || false
  };
}

function formatSongTime(dateString) {
  if (!dateString) return "--:--";

  return new Date(dateString).toLocaleTimeString("de-CH", {
    hour:   "2-digit",
    minute: "2-digit"
  });
}

function getCurrentTime() {
  return new Date().toLocaleTimeString("de-CH", {
    hour:   "2-digit",
    minute: "2-digit"
  });
}

function showLoader(isVisible) {
  loaderOverlay.classList.toggle("hidden", !isVisible);
}

async function keepLoaderVisible(startTime) {
  const remaining = MIN_LOADER_TIME - (Date.now() - startTime);
  if (remaining > 0) await wait(remaining);
}

function showSearchMessage(message, isError, container) {
  const paragraph = document.createElement("p");
  paragraph.classList.add("status");
  if (isError) paragraph.classList.add("error");
  paragraph.textContent = message;
  container.appendChild(paragraph);
}

function setStatus(message) {
  statusText.textContent = message;
  statusText.classList.remove("error");
}

function showError(message) {
  currentTitle.textContent  = "Keine Daten verfügbar";
  currentArtist.textContent = "";
  currentTime.textContent   = "";
  liveTimer.textContent     = "";
  currentLinks.innerHTML    = "";
  historyList.innerHTML     = "";
  timeSearchResults.innerHTML = "";
  statusText.textContent    = message;
  statusText.classList.add("error");
}

function clampNumber(value, min, max) {
  return Number.isNaN(value) ? min : Math.min(Math.max(value, min), max);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ── Init ─────────────────────────────────────────────────────────────────────

if (audioAnimation && window.lottie) {
  lottie.loadAnimation({
    container: audioAnimation,
    renderer:  "svg",
    loop:      true,
    autoplay:  true,
    path:      "/animationen/audiovis.json"
  });
}

loadInitialSongs();
