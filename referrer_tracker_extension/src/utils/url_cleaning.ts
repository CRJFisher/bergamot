// URL utilities for navigation comparison and tracking parameter handling

// Common tracking parameters that should be ignored for navigation detection
export const tracking_parameters = new Set([
  // Google Analytics and Google Ads
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gclsrc",
  "gbraid",
  "wbraid",
  "_ga",
  "_gl",
  "_gac",

  // Facebook
  "fbclid",
  "fb_action_ids",
  "fb_action_types",
  "fb_ref",
  "fb_source",

  // Microsoft/Bing
  "msclkid",
  "mc_cid",
  "mc_eid",

  // Twitter
  "twclid",
  "t_co",

  // LinkedIn
  "li_fat_id",

  // Generic tracking
  "ref",
  "referrer",
  "referer",
  "source",
  "src",
  "campaign",
  "camp",
  "medium",
  "med",
  "content",
  "cnt",
  "term",
  "keyword",

  // Email marketing
  "email_campaign",
  "email_source",
  "em_campaign",
  "em_source",

  // Analytics platforms
  "pk_campaign",
  "pk_kwd",
  "pk_source",
  "pk_medium",
  "pk_content", // Piwik/Matomo
  "cmpid",
  "cmp", // Campaign ID variations

  // Social media
  "igshid", // Instagram
  "share_id",
  "shared_from",

  // Affiliate tracking
  "affiliate",
  "aff",
  "aff_id",
  "affiliate_id",

  // Additional tracking parameters
  "_kx", // Klaviyo tracking
  "_ke", // Klaviyo email tracking
  "klaviyo", // Klaviyo general
  "kl_email", // Klaviyo email
  "mc_eid", // Mailchimp email ID (already exists but worth noting)
  "vero_id", // Vero email tracking
  "vero_conv", // Vero conversion tracking
  "yclid", // Yandex Click ID
  "gad_source", // Google Ads source parameter
  "srsltid", // Google Search results tracking
  "_hsenc", // HubSpot encrypted tracking
  "_hsmi", // HubSpot marketing info
  "hsCtaTracking", // HubSpot CTA tracking
  "hsa_acc", // HubSpot account
  "hsa_cam", // HubSpot campaign
  "hsa_grp", // HubSpot ad group
  "hsa_ad", // HubSpot ad
  "hsa_src", // HubSpot source
  "hsa_tgt", // HubSpot target
  "hsa_kw", // HubSpot keyword
  "hsa_mt", // HubSpot match type
  "hsa_net", // HubSpot network
  "hsa_ver", // HubSpot version
  "wickedid", // Wicked Reports tracking
  "wickedsource", // Wicked Reports source
  "wickedplacement", // Wicked Reports placement
  "_bta_tid", // Bronto tracking ID
  "_bta_c", // Bronto campaign
  "trk_contact", // Various email tracking
  "trk_msg", // Message tracking
  "trk_module", // Module tracking
  "trk_sid", // Session tracking
  "sp_cid", // SendPulse campaign ID
  "sp_rid", // SendPulse recipient ID
  "oft_id", // OptinMonster tracking
  "oft_k", // OptinMonster key
  "oft_lk", // OptinMonster link key
  "oft_d", // OptinMonster data
  "oft_c", // OptinMonster campaign
  "oft_ck", // OptinMonster cookie key
  "oftk", // OptinMonster tracking key
  "oftid", // OptinMonster ID
  "_branch_match_id", // Branch.io deep linking
  "_branch_referrer", // Branch.io referrer
  "~channel", // Branch.io channel
  "~feature", // Branch.io feature
  "~campaign", // Branch.io campaign
  "~stage", // Branch.io stage
  "~creation_source", // Branch.io creation source
  "~referring_link", // Branch.io referring link
  "~id", // Branch.io ID
  "s_cid", // Adobe Analytics campaign ID
  "s_kwcid", // Adobe Analytics keyword campaign ID
  "ef_id", // Adobe Advertising Cloud tracking
  "s_trackingid", // Adobe tracking ID
  "icid", // Internal campaign ID (various platforms)
  "ncid", // Newsletter campaign ID
  "cid", // Generic campaign ID
  "sid", // Session ID tracking
  "tid", // Transaction/tracking ID
  "rid", // Request/recipient ID
  "bid", // Banner/broadcast ID
  "pid", // Product/page ID (when used for tracking)
  "aid", // Advertisement ID
  "oid", // Order/offer ID
  "lid", // Link/landing ID
  "vid", // Visitor/view ID
  "nid", // Newsletter/notification ID
  "mid", // Message/media ID
  "did", // Device/destination ID
  "wid", // Widget/website ID
  "uid", // User ID (when used for tracking)
  "tracking_id",
  "track_id",
  "trackid",
  "tracker",
  "track",
  "trkid",
  "trk_id",
  "tr_id",
  "tid_id",
]);

// Function to normalize URL for navigation comparison by removing tracking params
export function normalize_url_for_navigation(url: string): string {
  console.log(`PKM: normalize_url_for_navigation input: ${url}`);
  try {
    const url_obj = new URL(url);
    const origin = url_obj.origin;
    const pathname = url_obj.pathname;
    const search_params = new URLSearchParams(url_obj.search);

    console.log(
      `PKM: URL parts - origin: ${origin}, pathname: ${pathname}, search: ${url_obj.search}, hash: ${url_obj.hash}`
    );

    // Remove tracking parameters
    for (const param of tracking_parameters) {
      search_params.delete(param);
    }

    // Reconstruct URL with meaningful query parameters only
    const clean_search = search_params.toString();
    const normalized =
      origin +
      pathname +
      (clean_search ? "?" + clean_search : "") +
      url_obj.hash;

    console.log(`PKM: normalize_url_for_navigation output: ${normalized}`);
    return normalized;
  } catch (e) {
    console.log(
      `PKM: normalize_url_for_navigation error: ${e}, falling back to manual parsing`
    );
    // Fallback for relative URLs or malformed URLs
    const base_url = url.split("?")[0].split("#")[0];

    // Try to parse query parameters manually for fallback
    const query_start = url.indexOf("?");
    if (query_start === -1) {
      console.log(
        `PKM: normalize_url_for_navigation fallback output: ${base_url}`
      );
      return base_url;
    }

    const query_string = url.substring(query_start + 1).split("#")[0];
    const params = new URLSearchParams(query_string);

    // Remove tracking parameters
    for (const param of tracking_parameters) {
      params.delete(param);
    }

    const clean_search = params.toString();
    const result = base_url + (clean_search ? "?" + clean_search : "");
    console.log(`PKM: normalize_url_for_navigation fallback output: ${result}`);
    return result;
  }
}
