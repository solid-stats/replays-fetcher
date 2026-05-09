interface ReplayRowObservation {
  readonly metadata: {
    readonly missionText?: string;
    readonly serverId?: number;
    readonly world?: string;
  };
  readonly page: number;
  readonly source: {
    readonly externalId?: string;
    readonly url?: string;
  };
}

interface MutableReplayRowMetadata {
  missionText?: string;
  serverId?: number;
  world?: string;
}

interface MutableReplayRowSource {
  externalId?: string;
  url?: string;
}

export function extractReplayRows(
  html: string,
  page: number,
  sourceUrl: URL,
): readonly ReplayRowObservation[] {
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
}

export function extractFilenameFromDetailHtml(
  html: string,
): string | undefined {
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
}

function parseReplayRow(
  rowHtml: string,
  page: number,
  sourceUrl: URL,
): ReplayRowObservation {
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

  return {
    metadata,
    page,
    source,
  };
}

function hrefToUrl(
  href: string | undefined,
  sourceUrl: URL,
): string | undefined {
  if (href === undefined) {
    return undefined;
  }

  return new URL(href, sourceUrl).toString();
}

function findInputValueById(html: string, id: string): string | undefined {
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
}

function getMatchGroup(match: RegExpMatchArray, group: string): string {
  /* v8 ignore next -- regexes using this helper always declare the group. */
  return match.groups?.[group] ?? "";
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replaceAll(/<[^>]+>/gu, " "));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
