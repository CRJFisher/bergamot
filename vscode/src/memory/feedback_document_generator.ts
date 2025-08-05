import { EpisodicMemory } from './types';
import { EpisodicMemoryStore } from './episodic_memory_store';
import { MarkdownDatabase } from '../markdown_db';
import * as vscode from 'vscode';

export class FeedbackDocumentGenerator {
  private memory_store: EpisodicMemoryStore;
  private markdown_db: MarkdownDatabase;

  constructor(memory_store: EpisodicMemoryStore, markdown_db: MarkdownDatabase) {
    this.memory_store = memory_store;
    this.markdown_db = markdown_db;
  }

  async generate_feedback_document(
    recent_days = 7,
    filtered_hours = 48
  ): Promise<string> {
    // Get episodes for different time windows
    const recent_episodes = await this.memory_store.get_recent_episodes(recent_days * 24);
    const filtered_episodes = await this.memory_store.get_recent_episodes(filtered_hours);
    const stats = await this.memory_store.get_correction_statistics();
    
    // Group episodes by decision
    const accepted_pages = recent_episodes.filter(e => e.original_decision);
    const filtered_pages = filtered_episodes.filter(e => !e.original_decision);
    
    // Generate markdown content
    const content = this.generate_markdown(
      accepted_pages,
      filtered_pages,
      stats,
      recent_days,
      filtered_hours
    );
    
    // Save to markdown database - upsert_raw writes the file directly
    await this.markdown_db.upsert_raw(
      '__recent_webpages__.md',
      content
    );
    
    // Note: Don't call save() on the returned instance as it has empty content
    return this.markdown_db.get_file_path('__recent_webpages__.md');
  }

  private generate_markdown(
    accepted_pages: EpisodicMemory[],
    filtered_pages: EpisodicMemory[],
    stats: any,
    recent_days: number,
    filtered_hours: number
  ): string {
    const now = new Date();
    
    const lines: string[] = [
      `# Webpage Review`,
      ``,
      `> Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
      ``,
      `Stats: ${stats.total_episodes} total pages | ${stats.total_corrections} corrections | ${(stats.correction_rate * 100).toFixed(1)}% correction rate`,
      ``
    ];

    // Recent webpages section
    if (accepted_pages.length > 0) {
      lines.push(`## Recent webpages`, ``);
      lines.push(`*Accepted pages from the last ${recent_days} days*`, ``);
      
      accepted_pages
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .forEach((episode) => {
          const correction_mark = episode.user_correction ? ' ⚠️' : '';
          const brief_reason = this.get_brief_reason(episode);
          
          lines.push(
            `- [${episode.content_features.title}](${episode.url})${correction_mark}`,
            `  ${brief_reason}`,
            ``
          );
        });
    } else {
      lines.push(`## Recent webpages`, ``);
      lines.push(`*No accepted pages in the last ${recent_days} days*`, ``);
    }

    // Filtered out webpages section
    lines.push(``);
    if (filtered_pages.length > 0) {
      lines.push(`## Filtered out webpages`, ``);
      lines.push(`*Filtered pages from the last ${filtered_hours} hours*`, ``);
      
      filtered_pages
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .forEach((episode) => {
          const correction_mark = episode.user_correction ? ' ⚠️' : '';
          const brief_reason = this.get_brief_reason(episode);
          
          lines.push(
            `- ~~[${episode.content_features.title}](${episode.url})~~${correction_mark}`,
            `  ${brief_reason}`,
            ``
          );
        });
    } else {
      lines.push(`## Filtered out webpages`, ``);
      lines.push(`*No filtered pages in the last ${filtered_hours} hours*`, ``);
    }

    // Add legend and help
    lines.push(
      ``,
      `---`,
      ``,
      `**Legend**: ⚠️ = User corrected`,
      ``,
      `Use \`PKM Assistant: Generate Filtering Review\` to refresh this document.`,
      ``,
      `*Configuration: Recent pages shown for ${recent_days} days, filtered pages shown for ${filtered_hours} hours*`
    );

    return lines.join('\n');
  }
  
  private get_brief_reason(episode: EpisodicMemory): string {
    // Use the reasoning from the LLM if available
    if (episode.reasoning && episode.reasoning.length > 0) {
      // If user corrected, show correction info
      if (episode.user_correction) {
        if (episode.user_correction.explanation) {
          // Truncate user explanation to 10 words
          const words = episode.user_correction.explanation.split(' ').slice(0, 8);
          return `Corrected: ${words.join(' ')}...`;
        } else if (episode.user_correction.corrected_type) {
          return `Corrected to ${episode.user_correction.corrected_type}`;
        } else {
          return `Corrected: should ${episode.user_correction.corrected_decision ? 'accept' : 'filter'}`;
        }
      }
      // Return the reasoning from LLM (should already be <10 words)
      return episode.reasoning;
    }
    
    // Fallback to type-based reason if no reasoning stored
    const type_map: Record<string, string> = {
      'knowledge': 'Knowledge content',
      'interactive_app': 'Web application',
      'aggregator': 'Link aggregator',
      'leisure': 'Entertainment content',
      'navigation': 'Navigation page',
      'other': 'Other content'
    };
    
    const base_reason = type_map[episode.page_type] || episode.page_type;
    const confidence_indicator = episode.confidence < 0.7 ? ' (low conf)' : '';
    
    return `${base_reason}${confidence_indicator}`;
  }


  async open_feedback_document(): Promise<void> {
    try {
      const file_path = this.markdown_db.get_file_path('__recent_webpages__.md');
      const doc = await vscode.workspace.openTextDocument(file_path);
      await vscode.window.showTextDocument(doc);
    } catch (error) {
      vscode.window.showInformationMessage('No feedback document found. Generate one first.');
    }
  }
}