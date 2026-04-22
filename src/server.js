const path = require("path");
const express = require("express");
const helmet = require("helmet");
const dotenv = require("dotenv");
const { rateLimit } = require("express-rate-limit");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.resolve(__dirname, "..", "public");
const vendorDirectory = path.resolve(__dirname, "..", "node_modules");
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
app.use("/vendor", express.static(vendorDirectory));
app.use(express.static(publicDirectory));
app.use("/api", apiLimiter);

app.post("/api/count-commits", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const owner = String(req.body?.owner || "").trim();
  const repo = String(req.body?.repo || "").trim();
  const branch = String(req.body?.branch || "").trim();
  let githubContext;

  try {
    githubContext = createGitHubContext(req.body?.githubToken);
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
    const user = await fetchUser(username, githubContext);

    if (repo) {
      const resolvedOwner = owner || username;
      const repository = await fetchRepository({ owner: resolvedOwner, repo }, githubContext);

      if (branch) {
        await fetchBranch({ owner: resolvedOwner, repo, branch }, githubContext);
      }

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
            : branch
              ? `${user.login} has no commits in ${repository.full_name} on branch "${selectedBranch}".`
              : `${user.login} has no commits in ${repository.full_name}.`,
          hint: isEmptyRepository
            ? "Push the first commit to that repository, or choose another repository with commit history."
            : "Check the username and repository. If the repo is correct, this account may simply have no commits there yet.",
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

    const repoCollection = await fetchOwnedRepositories(username, githubContext);

    if (repoCollection.repositories.length === 0) {
      throw createTypedError({
        statusCode: 404,
        errorType: "no_repositories_found",
        title: "No repositories found",
        message: `${user.login} does not have any owned repositories available to scan.`,
        hint: repoCollection.scopeHint,
      });
    }

    let totalCommits = 0;
    let repositoriesWithCommits = 0;

    for (const repository of repoCollection.repositories) {
      const commitCount = await countCommits({
        owner: repository.owner.login,
        repo: repository.name,
        username,
        branch: "",
      }, githubContext);

      totalCommits += commitCount;

      if (commitCount > 0) {
        repositoriesWithCommits += 1;
      }
    }

    if (totalCommits === 0) {
      throw createTypedError({
        statusCode: 422,
        errorType: "no_commits_found",
        title: "No matching commits found",
        message: `${user.login} has no commits across the scanned repositories.`,
        hint: repoCollection.scopeHint,
      });
    }

    return res.json({
      mode: "all_repositories",
      totalCommits,
      repositoryCount: repoCollection.repositories.length,
      repositoriesWithCommits,
      scopeLabel: repoCollection.scopeLabel,
      authenticated: Boolean(githubContext.token),
      username: user.login,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      errorType: error.errorType || "request_failed",
      title: error.title || "The count could not be completed.",
      message: error.message || "Unable to count commits.",
      hint: error.hint || "",
    });
  }
});

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
  let total = 0;
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
    );

    url.searchParams.set("author", username);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    if (branch) {
      url.searchParams.set("sha", branch);
    }

    const response = await fetch(url, {
      headers: buildGitHubHeaders(githubContext),
    });

    if (!response.ok) {
      if (await isEmptyRepositoryResponse(response)) {
        return 0;
      }

      throw await buildGitHubError(response, {
        notFoundMessage: branch
          ? `Unable to read commit history for branch "${branch}".`
          : "Unable to read commit history for this repository.",
      });
    }

    const commits = await response.json();
    total += commits.length;

    if (commits.length < perPage) {
      return total;
    }

    page += 1;
  }
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

function createGitHubContext(rawToken) {
  const requestToken = String(rawToken || "").trim();
  const tokenType = detectTokenType(requestToken);

  if (requestToken && tokenType !== "classic") {
    throw createTypedError({
      statusCode: 400,
      errorType: "token_format",
      title: "Use a classic GitHub token",
      message: "Only classic GitHub tokens are supported in this app.",
      hint: "Create a classic token that starts with ghp_ and make sure repo is checked in Scopes.",
    });
  }

  return {
    token: requestToken,
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
