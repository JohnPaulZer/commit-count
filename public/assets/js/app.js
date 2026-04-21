const form = document.querySelector("#commit-form");
const usernameInput = document.querySelector("#username");
const repositoryInput = document.querySelector("#repository");
const submitButton = document.querySelector("#submit-button");
const pageShell = document.querySelector(".page-shell");
const statusCard = document.querySelector("#status-card");
const statusTitle = document.querySelector("#status-title");
const statusText = document.querySelector("#status-text");
const statusLabel = document.querySelector(".status-label");
const loadingModal = document.querySelector("#loading-modal");
const loadingPlayer = document.querySelector("#loading-player");
const loadingModalTitle = document.querySelector("#loading-modal-title");
const loadingModalText = document.querySelector("#loading-modal-text");
const errorModal = document.querySelector("#error-modal");
const errorModalTitle = document.querySelector("#error-modal-title");
const errorModalText = document.querySelector("#error-modal-text");
const errorModalHint = document.querySelector("#error-modal-hint");
const errorModalClose = document.querySelector("#error-modal-close");
const errorModalDismiss = document.querySelector("#error-modal-dismiss");

const statusVariants = ["is-idle", "is-loading", "is-success", "is-error"];
let lastFocusedElement = null;

errorModalClose.addEventListener("click", hideErrorModal);
errorModalDismiss.addEventListener("click", hideErrorModal);
errorModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) {
    hideErrorModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorModal.hidden) {
    hideErrorModal();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const repositoryValue = repositoryInput.value.trim();

  if (!username) {
    presentError({
      errorType: "missing_input",
      title: "Missing required fields",
      message: "Provide your GitHub username.",
      hint: "Fill in the required fields and try again.",
    });
    return;
  }

  let repository = null;

  if (repositoryValue) {
    try {
      repository = parseRepository({
        repositoryValue,
        defaultOwner: username,
      });
    } catch (error) {
      presentError(toErrorDetails(error, {
        errorType: "repository_format",
        title: "Repository format is invalid",
        hint: "Use repo-name, owner/repo, or a GitHub HTTPS or SSH URL.",
      }));
      return;
    }
  }

  setBusy(true);
  hideErrorModal();
  setStatus({
    label: "Loading",
    title: repository
      ? "Checking the repository and scanning commits..."
      : "Scanning all owned repositories...",
    text: repository
      ? `Looking for commits authored by ${username} in ${repository.owner}/${repository.repo}.`
      : `Looking for commits authored by ${username} across all owned repositories.`,
    variant: "is-loading",
  });

  try {
    const result = await fetchCommitCount({
      owner: repository?.owner || "",
      repo: repository?.repo || "",
      username,
      branch: "",
    });
    displayResult(result, username);
  } catch (error) {
    presentError(toErrorDetails(error));
  } finally {
    setBusy(false);
  }
});

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Counting..." : "Count commits";
}

function setStatus({ label, title, text, variant }) {
  statusCard.classList.remove(...statusVariants);
  statusCard.classList.add(variant);
  statusLabel.textContent = label;
  statusTitle.textContent = title;
  statusText.textContent = text;
  setLoadingModalState({
    isVisible: variant === "is-loading",
    title,
    text,
  });
}

function presentError(errorDetails) {
  setStatus({
    label: getErrorLabel(errorDetails.errorType),
    title: errorDetails.title,
    text: errorDetails.message,
    variant: "is-error",
  });
  showErrorModal(errorDetails);
}

function parseRepository({ repositoryValue, defaultOwner }) {
  const trimmedValue = repositoryValue.trim().replace(/\.git$/i, "");

  if (!trimmedValue) {
    throw new Error("Enter a repository name, owner/repo, or a GitHub HTTPS or SSH repository URL.");
  }

  const sshShortcutMatch = trimmedValue.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);

  if (sshShortcutMatch) {
    return {
      owner: sshShortcutMatch[1],
      repo: sshShortcutMatch[2],
    };
  }

  if (
    trimmedValue.startsWith("http://") ||
    trimmedValue.startsWith("https://") ||
    trimmedValue.startsWith("ssh://")
  ) {
    const url = new URL(trimmedValue);
    const host = url.hostname.replace(/^www\./i, "");

    if (host !== "github.com") {
      throw new Error("Only GitHub repository URLs are supported.");
    }

    if (url.protocol === "ssh:" && url.username !== "git") {
      throw new Error("Use a GitHub SSH URL like ssh://git@github.com/owner/repo.git.");
    }

    if (!["http:", "https:", "ssh:"].includes(url.protocol)) {
      throw new Error("Use a GitHub HTTPS or SSH repository URL.");
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length < 2) {
      throw new Error("Use a full repository URL like https://github.com/owner/repo or git@github.com:owner/repo.git.");
    }

    return {
      owner: segments[0],
      repo: segments[1],
    };
  }

  const parts = trimmedValue.split("/").filter(Boolean);

  if (parts.length === 1) {
    return {
      owner: defaultOwner,
      repo: parts[0],
    };
  }

  if (parts.length !== 2) {
    throw new Error("Use a repo name, owner/repo, or a full GitHub HTTPS or SSH repository URL.");
  }

  return {
    owner: parts[0],
    repo: parts[1],
  };
}

async function fetchCommitCount({ owner, repo, username, branch }) {
  const response = await fetch("/api/count-commits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner,
      repo,
      username,
      branch,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw toErrorDetails(data, {
      errorType: "request_failed",
      title: "The count could not be completed",
      message: "Unable to count commits.",
      hint: "Try again in a moment.",
    });
  }

  return data;
}

function displayResult(result, fallbackUsername) {
  const commitLabel = result.totalCommits === 1 ? "commit" : "commits";

  if (result.mode === "all_repositories") {
    const repoLabel = result.repositoryCount === 1 ? "repository" : "repositories";
    const reposWithCommitsLabel = result.repositoriesWithCommits === 1 ? "repo" : "repos";
    const displayName = result.username || fallbackUsername;

    setStatus({
      label: "Result",
      title: `${result.totalCommits} ${commitLabel}`,
      text: `${displayName} authored ${result.totalCommits} ${commitLabel} across ${result.repositoryCount} ${repoLabel}. Found commits in ${result.repositoriesWithCommits} ${reposWithCommitsLabel}. Scope: ${result.scopeLabel}.`,
      variant: "is-success",
    });
    return;
  }

  setStatus({
    label: "Result",
    title: `${result.totalCommits} ${commitLabel}`,
    text: `${fallbackUsername} authored ${result.totalCommits} ${commitLabel} in ${result.repoFullName} (${result.visibility}).`,
    variant: "is-success",
  });
}

function showErrorModal({ title, message, hint }) {
  lastFocusedElement = document.activeElement;
  errorModalTitle.textContent = title;
  errorModalText.textContent = message;

  if (hint) {
    errorModalHint.hidden = false;
    errorModalHint.textContent = hint;
  } else {
    errorModalHint.hidden = true;
    errorModalHint.textContent = "";
  }

  errorModal.hidden = false;
  syncOverlayState();
  errorModalDismiss.focus();
}

function setLoadingModalState({ isVisible, title, text }) {
  if (isVisible) {
    loadingModalTitle.textContent = title;
    loadingModalText.textContent = text;
    loadingModal.hidden = false;
    syncOverlayState();

    if (loadingPlayer?.dotLottie) {
      loadingPlayer.dotLottie.play();
    }

    return;
  }

  if (!loadingModal.hidden) {
    loadingModal.hidden = true;

    if (loadingPlayer?.dotLottie) {
      loadingPlayer.dotLottie.pause();
    }
  }

  syncOverlayState();
}

function hideErrorModal() {
  if (errorModal.hidden) {
    return;
  }

  const restoreTarget = lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)
    ? lastFocusedElement
    : submitButton;

  if (errorModal.contains(document.activeElement)) {
    restoreTarget.focus();
  }

  errorModal.hidden = true;
  syncOverlayState();
}

function getErrorLabel(errorType) {
  const labels = {
    missing_input: "Missing input",
    repository_format: "Repository format",
    username_not_found: "Wrong username",
    repository_not_found: "Repository error",
    no_repositories_found: "No repositories",
    branch_not_found: "Branch error",
    no_commits_found: "No commits found",
    invalid_token: "Token error",
    sso_authorization_required: "SSO required",
    classic_pat_blocked: "Token policy",
    rate_limit: "Rate limit",
    access_denied: "Access denied",
  };

  return labels[errorType] || "GitHub API";
}

function toErrorDetails(error, fallback = {}) {
  if (!error) {
    return {
      errorType: fallback.errorType || "request_failed",
      title: fallback.title || "The count could not be completed",
      message: fallback.message || "Unable to count commits.",
      hint: fallback.hint || "",
    };
  }

  if (typeof error === "object") {
    return {
      errorType: error.errorType || fallback.errorType || "request_failed",
      title: error.title || fallback.title || "The count could not be completed",
      message: error.message || fallback.message || "Unable to count commits.",
      hint: error.hint || fallback.hint || "",
    };
  }

  return {
    errorType: fallback.errorType || "request_failed",
    title: fallback.title || "The count could not be completed",
    message: String(error),
    hint: fallback.hint || "",
  };
}

function syncOverlayState() {
  const hasVisibleOverlay = !loadingModal.hidden || !errorModal.hidden;
  pageShell.inert = hasVisibleOverlay;
  document.body.classList.toggle("modal-open", hasVisibleOverlay);
}
