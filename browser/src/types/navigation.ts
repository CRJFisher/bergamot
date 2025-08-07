// Immutable data classes - only hold data, no logic
export class TabHistory {
  constructor(
    public readonly previous_url?: string,
    public readonly current_url?: string,
    public readonly timestamp: number = Date.now(),
    public readonly previous_url_timestamp?: number,
    public readonly opener_tab_id?: number,
    public readonly group_id?: string
  ) {}
}

export class VisitData {
  constructor(
    public readonly url: string,
    public readonly page_loaded_at: string,
    public readonly referrer: string,
    public readonly content: string,
    public readonly referrer_timestamp?: number,
    // Group connection fields
    public readonly tab_id?: number,
    public readonly group_id?: string,
    public readonly opener_tab_id?: number
  ) {}

  // Allow spreading for compatibility with Record<string, unknown>
  [key: string]: unknown;
}

export class NavigationEvent {
  constructor(
    public readonly type: 'standard' | 'spa' | 'tab' | 'link',
    public readonly url: string,
    public readonly timestamp: number = Date.now(),
    public readonly referrer?: string
  ) {}
}

export class PKMConfig {
  constructor(
    public readonly api_base_url: string,
    public readonly debug: boolean = false,
    public readonly log_level: 'error' | 'warn' | 'info' | 'debug' = 'info'
  ) {}
}

export class ReferrerInfo {
  constructor(
    public readonly referrer: string,
    public readonly referrer_timestamp?: number,
    // Group connection info
    public readonly tab_id?: number,
    public readonly group_id?: string,
    public readonly opener_tab_id?: number
  ) {}
}