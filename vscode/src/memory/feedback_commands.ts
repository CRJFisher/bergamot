import * as vscode from 'vscode';
import { EpisodicMemoryStore } from './episodic_memory_store';
import { FeedbackDocumentGenerator } from './feedback_document_generator';
import { UserCorrection } from './types';

export function register_feedback_commands(
  context: vscode.ExtensionContext,
  memory_store: EpisodicMemoryStore,
  feedback_generator: FeedbackDocumentGenerator
): void {
  // Command to generate feedback document
  const generate_feedback_command = vscode.commands.registerCommand(
    'mindsteep.generateFilteringReview',
    async () => {
      try {
        // Get configuration or use defaults
        const config = vscode.workspace.getConfiguration('mindsteep.agentMemory');
        const recent_days = config.get<number>('recentPagesDays', 7);
        const filtered_hours = config.get<number>('filteredPagesHours', 48);
        
        const file_path = await feedback_generator.generate_feedback_document(recent_days, filtered_hours);
        const doc = await vscode.workspace.openTextDocument(file_path);
        await vscode.window.showTextDocument(doc);
        
        vscode.window.showInformationMessage(
          `Generated filtering review: ${recent_days} days for accepted, ${filtered_hours} hours for filtered`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to generate review: ${error.message}`);
      }
    }
  );
  
  // Command to correct a decision
  const correct_decision_command = vscode.commands.registerCommand(
    'mindsteep.correctDecision',
    async (episode_id: string) => {
      try {
        const episodes = await memory_store.get_recent_episodes(720); // Last 30 days
        const episode = episodes.find(e => e.id === episode_id);
        
        if (!episode) {
          vscode.window.showErrorMessage('Episode not found');
          return;
        }
        
        const correction: UserCorrection = {
          corrected_decision: !episode.original_decision,
          feedback_timestamp: new Date()
        };
        
        await memory_store.add_user_correction(episode_id, correction);
        
        vscode.window.showInformationMessage(
          `Corrected: Page should be ${correction.corrected_decision ? 'accepted' : 'filtered'}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to correct decision: ${error.message}`);
      }
    }
  );
  
  // Command to correct page type
  const correct_type_command = vscode.commands.registerCommand(
    'mindsteep.correctType',
    async (episode_id: string) => {
      try {
        const type_options = [
          'knowledge',
          'interactive_app',
          'aggregator',
          'leisure',
          'navigation',
          'other'
        ];
        
        const selected_type = await vscode.window.showQuickPick(type_options, {
          placeHolder: 'Select the correct page type'
        });
        
        if (!selected_type) return;
        
        const episodes = await memory_store.get_recent_episodes(720);
        const episode = episodes.find(e => e.id === episode_id);
        
        if (!episode) {
          vscode.window.showErrorMessage('Episode not found');
          return;
        }
        
        const correction: UserCorrection = {
          corrected_decision: episode.original_decision,
          corrected_type: selected_type,
          feedback_timestamp: new Date()
        };
        
        await memory_store.add_user_correction(episode_id, correction);
        
        vscode.window.showInformationMessage(
          `Corrected type to: ${selected_type}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to correct type: ${error.message}`);
      }
    }
  );
  
  // Command to add explanation
  const add_explanation_command = vscode.commands.registerCommand(
    'mindsteep.addExplanation',
    async (episode_id: string) => {
      try {
        const explanation = await vscode.window.showInputBox({
          prompt: 'Add explanation for this correction',
          placeHolder: 'e.g., This is a tutorial, not an app'
        });
        
        if (!explanation) return;
        
        const episodes = await memory_store.get_recent_episodes(720);
        const episode = episodes.find(e => e.id === episode_id);
        
        if (!episode) {
          vscode.window.showErrorMessage('Episode not found');
          return;
        }
        
        const existing_correction = episode.user_correction || {
          corrected_decision: episode.original_decision,
          feedback_timestamp: new Date()
        };
        
        const correction: UserCorrection = {
          ...existing_correction,
          explanation,
          feedback_timestamp: new Date()
        };
        
        await memory_store.add_user_correction(episode_id, correction);
        
        vscode.window.showInformationMessage('Explanation added');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to add explanation: ${error.message}`);
      }
    }
  );
  
  // Command to show memory statistics
  const show_stats_command = vscode.commands.registerCommand(
    'mindsteep.showMemoryStats',
    async () => {
      try {
        const stats = await memory_store.get_correction_statistics();
        
        const output = vscode.window.createOutputChannel('PKM Assistant Memory Statistics');
        output.clear();
        output.appendLine('=== Agent Memory Statistics ===');
        output.appendLine('');
        output.appendLine(`Total Episodes: ${stats.total_episodes}`);
        output.appendLine(`User Corrections: ${stats.total_corrections} (${(stats.correction_rate * 100).toFixed(1)}%)`);
        output.appendLine(`False Positives: ${stats.false_positives}`);
        output.appendLine(`False Negatives: ${stats.false_negatives}`);
        output.appendLine('');
        output.appendLine('Corrections by Type:');
        
        for (const [type, count] of Object.entries(stats.corrections_by_type)) {
          output.appendLine(`  ${type}: ${count}`);
        }
        
        output.show();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to show statistics: ${error.message}`);
      }
    }
  );
  
  // Register all commands
  context.subscriptions.push(
    generate_feedback_command,
    correct_decision_command,
    correct_type_command,
    add_explanation_command,
    show_stats_command
  );
}