const path = require("path");
const express = require("express");
const helmet = require("helmet");
const dotenv = require("dotenv");
const { rateLimit } = require("express-rate-limit");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const port = Number(process.env.PORT) || 3000;
const defaultGitHubToken = String(process.env.GITHUB_TOKEN || "").trim();
const commitSearchCache = new Map();
const publicDirectory = path.resolve(__dirname, "..", "public");
const isDevelopment = app.get("env") === "development";
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      errorType: "rate_limit",
      title: "Too many requests",
      message: "Too many requests were sent to this API.",
      hint: "Please wait a moment and try again.",
    });
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "upgrade-insecure-requests": isDevelopment ? null : [],
      "script-src": ["'self'", "'wasm-unsafe-eval'"],
      "worker-src": ["'self'", "blob:"],
    },
  },
}));
app.use(express.static(publicDirectory));
app.use("/api", apiLimiter);

app.get("/api/count-commits", async (req, res) => {
  const username = String(req.query?.username || "").trim();

  if (!username) {
    return res.json({
      errorType: "missing_input",
      title: "GitHub username is required",
      message: "Send a POST request with a JSON body, or use a GET request with ?username=octocat.",
      hint: "GET requests are limited to public data. Use POST if you need to send a GitHub token safely.",
    });
  }

  return handleCountCommits({
    username,
    owner: String(req.query?.owner || ""),
    repo: String(req.query?.repo || ""),
    branch: String(req.query?.branch || ""),
    githubToken: "",
  }, res);
});

app.post("/api/count-commits", async (req, res) => handleCountCommits(req.body, res));

async function handleCountCommits(payload, res) {
  const username = String(payload?.username || "").trim();
  const owner = String(payload?.owner || "").trim();
  const repo = String(payload?.repo || "").trim();
  const branch = String(payload?.branch || "").trim();
  let githubContext;

  try {
    githubContext = createGitHubContext(payload?.githubToken);
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      errorType: error.errorType || "request_failed",
      title: error.title || "The request is invalid.",
      message: error.message || "Unable to process this request.",
      hint: error.hint || "",
    });
  }

  if (!username) {
    return res.status(400).json({
      errorType: "missing_input",
      title: "Missing required fields",
      message: "GitHub username is required.",
      hint: "Enter a username. The repository is optional.",
    });
  }

  try {
    if (repo) {
      const resolvedOwner = owner || username;

      if (branch) {
        const repository = await fetchRepository({ owner: resolvedOwner, repo }, githubContext);
        await fetchBranch({ owner: resolvedOwner, repo, branch }, githubContext);

        const totalCommits = await countCommits({
          owner: resolvedOwner,
          repo,
          username,
          branch,
        }, githubContext);
        const selectedBranch = branch || repository.default_branch;
        const isEmptyRepository = repository.size === 0;

        if (totalCommits === 0) {
          throw createTypedError({
            statusCode: 422,
            errorType: "no_commits_found",
            title: "No matching commits found",
            message: isEmptyRepository
              ? `${repository.full_name} is empty and does not have any commits yet.`
              : `${username} has no commits in ${repository.full_name} on branch "${selectedBranch}".`,
            hint: isEmptyRepository
              ? "Push the first commit to that repository, or choose another repository with commit history."
              : "Check the username, repository, and branch. If they are correct, this account may simply have no commits there yet.",
          });
        }

        return res.json({
          mode: "single_repo",
          totalCommits,
          repoFullName: repository.full_name,
          visibility: repository.private ? "private" : "public",
          branch: selectedBranch,
          defaultBranch: repository.default_branch,
          authenticated: Boolean(githubContext.token),
        });
      }

      const totalCommits = await searchCommitCount({
        owner: resolvedOwner,
        repo,
        username,
      }, githubContext);

      if (totalCommits === 0) {
        const repository = await fetchRepository({ owner: resolvedOwner, repo }, githubContext);
        const user = await fetchUser(username, githubContext);
        const isEmptyRepository = repository.size === 0;

        throw createTypedError({
          statusCode: 422,
          errorType: "no_commits_found",
          title: "No matching commits found",
          message: isEmptyRepository
            ? `${repository.full_name} is empty and does not have any commits yet.`
            : `${user.login} has no commits in ${repository.full_name}.`,
          hint: isEmptyRepository
            ? "Push the first commit to that repository, or choose another repository with commit history."
            : "Check the username and repository. If the repo is correct, this account may simply have no commits there yet.",
        });
      }

      return res.json({
        mode: "single_repo",
        totalCommits,
        repoFullName: `${resolvedOwner}/${repo}`,
        visibility: "",
        branch: "",
        defaultBranch: "",
        authenticated: Boolean(githubContext.token),
      });
    }

    const totalCommits = await searchCommitCount({
      owner: username,
      repo: "",
      username,
      scope: "user",
    }, githubContext);

    if (totalCommits === 0) {
      const user = await fetchUser(username, githubContext);

      throw createTypedError({
        statusCode: 422,
        errorType: "no_commits_found",
        title: "No matching commits found",
        message: `${user.login} has no commits across the scanned repositories.`,
        hint: buildSearchScopeHint(githubContext),
      });
    }

    return res.json({
      mode: "all_repositories",
      totalCommits,
      repositoryCount: null,
      repositoriesWithCommits: null,
      scopeLabel: buildSearchScopeLabel(githubContext),
      authenticated: Boolean(githubContext.token),
      username,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      errorType: error.errorType || "request_failed",
      title: error.title || "The count could not be completed.",
      message: error.message || "Unable to count commits.",
      hint: error.hint || "",
    });
  }
}

app.listen(port, () => {
  console.log(`GitHub Commit Counter running at http://localhost:${port}`);
});

async function fetchRepository({ owner, repo }, githubContext) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: buildGitHubHeaders(githubContext),
    },
  );

  if (!response.ok) {
    throw await buildGitHubError(response, {
      notFoundMessage: buildRepositoryNotFoundMessage(githubContext),
      notFoundTitle: "Repository not found",
      notFoundType: "repository_not_found",
      notFoundHint: buildRepositoryNotFoundHint(githubContext),
    });
  }

  return response.json();
}

async function fetchOwnedRepositories(username, githubContext) {
  const authenticatedUser = await fetchAuthenticatedUser(githubContext);
  const canReadOwnedPrivateRepositories = authenticatedUser
    && authenticatedUser.login.toLowerCase() === username.toLowerCase();

  if (canReadOwnedPrivateRepositories) {
    const repositories = await fetchPaginatedResults("https://api.github.com/user/repos", {
      affiliation: "owner",
      per_page: "100",
      sort: "updated",
      direction: "desc",
    }, githubContext);

    return {
      repositories,
      scopeLabel: "public and owned private repositories",
      scopeHint: "This scan includes repositories owned by this account that your GitHub token can access.",
    };
  }

  const repositories = await fetchPaginatedResults(
    `https://api.github.com/users/${encodeURIComponent(username)}/repos`,
    {
      type: "owner",
      per_page: "100",
      sort: "updated",
      direction: "desc",
    },
    githubContext,
  );

  return {
    repositories,
    scopeLabel: "public repositories",
    scopeHint: "This scan only includes public repositories for that username. Add a token from the same account to include owned private repositories too.",
  };
}

async function fetchUser(username, githubContext) {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username)}`,
    {
      headers: buildGitHubHeaders(githubContext),
    },
  );

  if (response.status === 404) {
    throw createTypedError({
      statusCode: 404,
      errorType: "username_not_found",
      title: "GitHub username not found",
      message: `The GitHub user "${username}" does not exist.`,
      hint: "Check the spelling of the username and try again.",
    });
  }

  if (!response.ok) {
    throw await buildGitHubError(response, {
      notFoundMessage: `The GitHub user "${username}" was not found.`,
      notFoundTitle: "GitHub username not found",
      notFoundType: "username_not_found",
      notFoundHint: "Check the spelling of the username and try again.",
    });
  }

  return response.json();
}

async function fetchAuthenticatedUser(githubContext) {
  if (!githubContext.token) {
    return null;
  }

  if (!githubContext.authenticatedUserPromise) {
    githubContext.authenticatedUserPromise = (async () => {
      const response = await fetch("https://api.github.com/user", {
        headers: buildGitHubHeaders(githubContext),
      });

      if (!response.ok) {
        throw await buildGitHubError(response, {
          notFoundMessage: "Unable to read the authenticated GitHub user.",
          notFoundTitle: "Authenticated user not found",
          notFoundType: "authenticated_user_not_found",
          notFoundHint: "Check the classic GitHub token in the form and try again.",
        });
      }

      return response.json();
    })();
  }

  return githubContext.authenticatedUserPromise;
}

async function fetchBranch({ owner, repo, branch }, githubContext) {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
    {
      headers: buildGitHubHeaders(githubContext),
    },
  );

  if (!response.ok) {
    throw await buildGitHubError(response, {
      notFoundMessage: `Branch "${branch}" was not found in ${owner}/${repo}.`,
      notFoundTitle: "Branch not found",
      notFoundType: "branch_not_found",
      notFoundHint: "Check the branch name or leave the field blank to use the repository default branch.",
    });
  }

  return response.json();
}

async function fetchPaginatedResults(baseUrl, queryParams, githubContext) {
  const results = [];
  let page = 1;

  while (true) {
    const url = new URL(baseUrl);

    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }

    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: buildGitHubHeaders(githubContext),
    });

    if (!response.ok) {
      throw await buildGitHubError(response, {
        notFoundMessage: "Unable to fetch the repository list for this user.",
        notFoundTitle: "Repository list unavailable",
        notFoundType: "repository_list_unavailable",
        notFoundHint: "Check the username and token access, then try again.",
      });
    }

    const pageResults = await response.json();
    results.push(...pageResults);

    if (pageResults.length < Number(queryParams.per_page || 100)) {
      return results;
    }

    page += 1;
  }
}

async function countCommits({ owner, repo, username, branch }, githubContext) {
  const perPage = 100;
  const pageCache = new Map();
  const loadPage = async (page, options = {}) => {
    if (pageCache.has(page)) {
      return pageCache.get(page);
    }

    const pageResult = await fetchCommitPage({
      owner,
      repo,
      username,
      branch,
      page,
      perPage,
    }, githubContext, options);

    pageCache.set(page, pageResult);
    return pageResult;
  };
  const firstPage = await loadPage(1, { allowEmptyRepository: true });

  if (firstPage.isEmptyRepository || firstPage.commits.length === 0) {
    return 0;
  }

  const lastPageNumber = parseLastPageNumber(firstPage.linkHeader);

  if (lastPageNumber !== null) {
    const finalPage = lastPageNumber === 1
      ? firstPage
      : await loadPage(lastPageNumber);

    return countCommitsFromPageCount(lastPageNumber, finalPage.commits.length, perPage);
  }

  if (!hasNextPage(firstPage.linkHeader)) {
    return firstPage.commits.length;
  }

  let low = 1;
  let high = 2;

  while (true) {
    const pageResult = await loadPage(high, { allowProbeFailureAsEmpty: true });

    if (pageResult.commits.length === 0) {
      break;
    }

    low = high;
    high *= 2;
  }

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const pageResult = await loadPage(middle, { allowProbeFailureAsEmpty: true });

    if (pageResult.commits.length === 0) {
      high = middle;
    } else {
      low = middle;
    }
  }

  const finalPage = await loadPage(low);
  return countCommitsFromPageCount(low, finalPage.commits.length, perPage);
}

async function searchCommitCount({ owner, repo, username, scope = "repo" }, githubContext) {
  const query = buildCommitSearchQuery({ owner, repo, username, scope });
  const cacheKey = [
    scope,
    owner,
    repo,
    username,
    githubContext.token || "public",
  ].join("|");
  const cachedResult = commitSearchCache.get(cacheKey);

  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    return cachedResult.totalCount;
  }

  const url = new URL("https://api.github.com/search/commits");
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", "1");

  const response = await fetch(url, {
    headers: buildGitHubHeaders(githubContext),
  });

  if (!response.ok) {
    throw await buildGitHubError(response, {
      notFoundMessage: repo
        ? "Unable to search commit history for this repository."
        : "Unable to search commit history for this account.",
      notFoundTitle: "Commit search unavailable",
      notFoundType: "commit_search_unavailable",
      notFoundHint: repo
        ? "Check the username, repository, and token access, then try again."
        : "Check the username and token access, then try again.",
    });
  }

  const searchResult = await response.json();
  const totalCount = Number(searchResult.total_count || 0);

  commitSearchCache.set(cacheKey, {
    totalCount,
    expiresAt: Date.now() + (60 * 1000),
  });

  return totalCount;
}

function buildGitHubHeaders(githubContext) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-commit-counter",
  };

  if (githubContext.token) {
    headers.Authorization = `Bearer ${githubContext.token}`;
  }

  return headers;
}

function buildRepositoryNotFoundMessage(githubContext) {
  if (!githubContext.token) {
    return "Repository not found. If this is a private repo, paste a classic GitHub token into the form.";
  }

  return "Repository not found, or the token does not have access to it.";
}

function buildRepositoryNotFoundHint(githubContext) {
  if (!githubContext.token) {
    return "Use a GitHub token for private repositories, or double-check the owner and repository name.";
  }

  return "Check the owner, repository name, and whether your token can read that repository.";
}

function buildCommitSearchQuery({ owner, repo, username, scope }) {
  const qualifiers = [`author:${username}`];

  if (scope === "user") {
    qualifiers.push(`user:${owner}`);
  } else {
    qualifiers.push(`repo:${owner}/${repo}`);
  }

  return qualifiers.join(" ");
}

function buildSearchScopeLabel(githubContext) {
  if (githubContext.token) {
    return "public repositories and any accessible private repositories";
  }

  return "public repositories";
}

function buildSearchScopeHint(githubContext) {
  if (githubContext.token) {
    return "This search checked public repositories and any private repositories your token can access.";
  }

  return "This search only checked public repositories. Add a token to include accessible private repositories too.";
}

function parseLastPageNumber(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const lastLink = linkHeader
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.endsWith('rel="last"'));

  if (!lastLink) {
    return null;
  }

  const urlMatch = lastLink.match(/<([^>]+)>/);

  if (!urlMatch) {
    return null;
  }

  try {
    const page = Number(new URL(urlMatch[1]).searchParams.get("page"));
    return Number.isInteger(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

function hasNextPage(linkHeader) {
  if (!linkHeader) {
    return false;
  }

  return linkHeader
    .split(",")
    .map((value) => value.trim())
    .some((value) => value.endsWith('rel="next"'));
}

function countCommitsFromPageCount(pageNumber, finalPageSize, perPage) {
  return ((pageNumber - 1) * perPage) + finalPageSize;
}

async function buildGitHubError(
  response,
  { notFoundMessage, notFoundTitle, notFoundType, notFoundHint },
) {
  let apiMessage = "";

  try {
    const errorData = await response.json();
    apiMessage = errorData.message || "";
  } catch {
    apiMessage = "";
  }

  if (response.status === 404) {
    return createTypedError({
      statusCode: 404,
      errorType: notFoundType || "not_found",
      title: notFoundTitle || "Resource not found",
      message: notFoundMessage,
      hint: notFoundHint || "Check the values you entered and try again.",
    });
  }

  if (response.status === 401) {
    return createTypedError({
      statusCode: 401,
      errorType: "invalid_token",
      title: "Token invalid or expired",
      message: "The GitHub token is invalid or expired.",
      hint: "Create a new classic token, paste it into the form, and try again.",
    });
  }

  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    const resetUnix = response.headers.get("x-ratelimit-reset");
    const resetDate = resetUnix ? new Date(Number(resetUnix) * 1000) : null;
    const readableReset = resetDate ? resetDate.toLocaleString() : "later";

    return createTypedError({
      statusCode: 429,
      errorType: "rate_limit",
      title: "Try again later",
      message: `Try again after ${readableReset}.`,
      hint: "Wait for the reset time, or use your own classic token.",
    });
  }

  const normalizedMessage = apiMessage.toLowerCase();

  if (response.status === 403 && normalizedMessage.includes("saml")) {
    return createTypedError({
      statusCode: 403,
      errorType: "sso_authorization_required",
      title: "SSO authorization required",
      message: apiMessage,
      hint: "Authorize the token for your organization in GitHub, then try again with the updated token.",
    });
  }

  if (
    response.status === 403 &&
    normalizedMessage.includes("personal access token") &&
    normalizedMessage.includes("classic")
  ) {
    return createTypedError({
      statusCode: 403,
      errorType: "classic_pat_blocked",
      title: "Classic PAT access is blocked",
      message: apiMessage,
      hint: "Ask the organization owner whether classic PAT access is disabled, or use another approved access method.",
    });
  }

  if (response.status === 403) {
    return createTypedError({
      statusCode: 403,
      errorType: "access_denied",
      title: "Access denied",
      message: apiMessage || "GitHub denied access to this resource.",
      hint: "Check whether the token can read the repository and whether the organization allows that token type.",
    });
  }

  if (apiMessage) {
    return createTypedError({
      statusCode: response.status,
      errorType: "github_api_error",
      title: "GitHub API error",
      message: apiMessage,
      hint: "Review the input values and token permissions, then try again.",
    });
  }

  return createTypedError({
    statusCode: response.status,
    errorType: "github_api_error",
    title: "GitHub API error",
    message: `GitHub API request failed with status ${response.status}.`,
    hint: "Try again in a moment or review the input values and token access.",
  });
}

async function isEmptyRepositoryResponse(response) {
  if (response.status !== 409) {
    return false;
  }

  try {
    const errorData = await response.clone().json();
    return String(errorData.message || "").toLowerCase().includes("repository is empty");
  } catch {
    return false;
  }
}

async function fetchCommitPage(
  { owner, repo, username, branch, page, perPage },
  githubContext,
  {
    allowEmptyRepository = false,
    allowProbeFailureAsEmpty = false,
  } = {},
) {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
  );

  url.searchParams.set("author", username);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));

  if (branch) {
    url.searchParams.set("sha", branch);
  }

  let response = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: buildGitHubHeaders(githubContext),
      });
      lastError = null;
    } catch (error) {
      response = null;
      lastError = error;
    }

    if (response && response.status < 500) {
      break;
    }

    if (attempt === 1) {
      break;
    }
  }

  if (!response) {
    if (allowProbeFailureAsEmpty) {
      return {
        commits: [],
        isEmptyRepository: false,
        linkHeader: null,
      };
    }

    throw lastError;
  }

  if (!response.ok) {
    if (allowEmptyRepository && await isEmptyRepositoryResponse(response)) {
      return {
        commits: [],
        isEmptyRepository: true,
        linkHeader: response.headers.get("link"),
      };
    }

    if (allowProbeFailureAsEmpty && response.status >= 500) {
      return {
        commits: [],
        isEmptyRepository: false,
        linkHeader: response.headers.get("link"),
      };
    }

    throw await buildGitHubError(response, {
      notFoundMessage: branch
        ? `Unable to read commit history for branch "${branch}".`
        : "Unable to read commit history for this repository.",
    });
  }

  return {
    commits: await response.json(),
    isEmptyRepository: false,
    linkHeader: response.headers.get("link"),
  };
}

function createGitHubContext(rawToken) {
  const requestToken = String(rawToken || "").trim();
  const resolvedToken = requestToken || defaultGitHubToken;
  const tokenType = detectTokenType(resolvedToken);

  if (resolvedToken && tokenType !== "classic") {
    throw createTypedError({
      statusCode: 400,
      errorType: "token_format",
      title: "Use a classic GitHub token",
      message: "Only classic GitHub tokens are supported in this app.",
      hint: "Use a classic token that starts with ghp_. You can paste it into the form or set GITHUB_TOKEN in .env.",
    });
  }

  return {
    token: resolvedToken,
    tokenType,
    authenticatedUserPromise: null,
  };
}

function detectTokenType(token) {
  if (!token) {
    return "none";
  }

  if (token.startsWith("github_pat_")) {
    return "fine-grained";
  }

  if (token.startsWith("ghp_")) {
    return "classic";
  }

  return "unknown";
}

function createTypedError({ statusCode, errorType, title, message, hint = "" }) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorType = errorType;
  error.title = title;
  error.hint = hint;
  return error;
}
