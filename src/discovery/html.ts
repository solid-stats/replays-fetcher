type ReplayRowObservation = {
  readonly metadata: {
    readonly discoveredAt?: string;
    readonly missionText?: string;
    readonly serverId?: number;
    readonly world?: string;
  };
  readonly page: number;
  readonly source: {
    readonly externalId?: string;
    readonly url?: string;
  };
};

type MutableReplayRowMetadata = {
  discoveredAt?: string;
  missionText?: string;
  serverId?: number;
  world?: string;
};

type MutableReplayRowSource = {
  externalId?: string;
  url?: string;
};

/* v8 ignore next -- regexes using this helper always declare the group. */
const getMatchGroup = (match: RegExpMatchArray, group: string): string =>
  match.groups?.[group] ?? "";

const decodeHtmlEntities = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const stripTags = (html: string): string =>
  decodeHtmlEntities(html.replaceAll(/<[^>]+>/gu, " "));

/**
 * Parse the listing "Game date" cell (day-first `DD.MM.YYYY HH:MM`, no seconds)
 * into a UTC ISO string. Mirrors `replayTimestampFromFilename` in staging, but
 * for the day-first listing format — UTC by parity with the live filename
 * convention. Returns undefined for empty/malformed/year-first input (never
 * throws). The regex is fully anchored with fixed-width groups — ReDoS-safe.
 */
export const parseGameDateToUtcIso = (cell: string): string | undefined => {
  const match =
    /^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4})\s+(?<hour>\d{2}):(?<minute>\d{2})$/u.exec(
      cell.trim(),
    );

  if (match?.groups === undefined) {
    return undefined;
  }

  const { day, hour, minute, month, year } = match.groups as Record<
    "day" | "hour" | "minute" | "month" | "year",
    string
  >;

  return `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
};

const hrefToUrl = (
  href: string | undefined,
  sourceUrl: URL,
): string | undefined => {
  if (href === undefined) {
    return undefined;
  }

  try {
    const resolved = new URL(href, sourceUrl);

    if (
      resolved.origin !== sourceUrl.origin ||
      !resolved.pathname.startsWith("/replays/")
    ) {
      return undefined;
    }

    return resolved.toString();
  } catch {
    return undefined;
  }
};

const findInputValueById = (html: string, id: string): string | undefined => {
  for (const match of html.matchAll(/<input\b(?<attributes>[^>]*)>/giu)) {
    const attributes = getMatchGroup(match, "attributes");
    const inputId = /\bid=(?<quote>["'])(?<id>.*?)\k<quote>/iu.exec(attributes)
      ?.groups?.["id"];

    if (inputId === id) {
      return /\bvalue=(?<quote>["'])(?<value>.*?)\k<quote>/iu.exec(attributes)
        ?.groups?.["value"];
    }
  }

  return undefined;
};

const parseReplayRow = (
  rowHtml: string,
  page: number,
  sourceUrl: URL,
): ReplayRowObservation => {
  const cells = [
    ...rowHtml.matchAll(/<td[^>]*>(?<cell>[\s\S]*?)<\/td>/giu),
  ].map((match) => getMatchGroup(match, "cell"));
  const link =
    /<a\b[^>]*\bhref=(?<quote>["'])(?<href>.*?)\k<quote>[^>]*>(?<text>[\s\S]*?)<\/a>/iu.exec(
      cells[0] ?? "",
    );
  const href = link?.groups?.["href"]?.trim();
  const url = hrefToUrl(href, sourceUrl);
  const externalId = /\/replays\/(?<id>[^/?#]+)/iu.exec(url ?? "")?.groups?.[
    "id"
  ];
  const serverIdText = stripTags(cells[2] ?? "").trim();
  const serverId = Number.parseInt(serverIdText, 10);
  const gameDateText = stripTags(cells[3] ?? "").trim();
  const discoveredAt = parseGameDateToUtcIso(gameDateText);
  const source: MutableReplayRowSource = {};
  const metadata: MutableReplayRowMetadata = {};

  if (externalId !== undefined) {
    source.externalId = externalId;
  }

  if (url !== undefined) {
    source.url = url;
  }

  const missionText = stripTags(link?.groups?.["text"] ?? "").trim();
  const world = stripTags(cells[1] ?? "").trim();

  if (missionText.length > 0) {
    metadata.missionText = missionText;
  }

  if (world.length > 0) {
    metadata.world = world;
  }

  if (!Number.isNaN(serverId)) {
    metadata.serverId = serverId;
  }

  if (discoveredAt !== undefined) {
    metadata.discoveredAt = discoveredAt;
  }

  return {
    metadata,
    page,
    source,
  };
};

export const extractReplayRows = (
  html: string,
  page: number,
  sourceUrl: URL,
): readonly ReplayRowObservation[] => {
  const tableMatch =
    /<table[^>]*class=["'][^"']*\bcommon-table\b[^"']*["'][^>]*>[\s\S]*?<tbody[^>]*>(?<body>[\s\S]*?)<\/tbody>[\s\S]*?<\/table>/iu.exec(
      html,
    );
  const tableBody = tableMatch?.groups?.["body"];

  if (tableBody === undefined) {
    return [];
  }

  return [...tableBody.matchAll(/<tr[^>]*>(?<row>[\s\S]*?)<\/tr>/giu)].map(
    (match) => parseReplayRow(getMatchGroup(match, "row"), page, sourceUrl),
  );
};

export const extractFilenameFromDetailHtml = (
  html: string,
): string | undefined => {
  const filenameValue = findInputValueById(html, "filename")?.trim();

  if (filenameValue !== undefined && filenameValue.length > 0) {
    return decodeHtmlEntities(filenameValue);
  }

  // Legacy fallback selector: body[data-ocap].
  const bodyMatch =
    /<body\b[^>]*\bdata-ocap=(?<quote>["'])(?<filename>.*?)\k<quote>[^>]*>/iu.exec(
      html,
    );
  const bodyOcap = bodyMatch?.groups?.["filename"]?.trim();

  if (bodyOcap !== undefined && bodyOcap.length > 0) {
    return decodeHtmlEntities(bodyOcap);
  }

  return undefined;
};
