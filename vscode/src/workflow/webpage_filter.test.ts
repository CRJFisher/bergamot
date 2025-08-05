import { jest } from '@jest/globals';
import { 
  classify_webpage, 
  should_process_page, 
  log_filter_decision,
  PageClassification,
  FilterConfig,
  DEFAULT_FILTER_CONFIG 
} from './webpage_filter';

describe('webpage_filter', () => {
  describe('classify_webpage', () => {
    it('should classify a knowledge page correctly', async () => {
      const mock_llm_complete = jest.fn<
        (prompt: string, system_prompt: string, model?: string) => Promise<PageClassification>
      >().mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.9,
        reasoning: 'Technical documentation',
        should_process: true
      });

      const result = await classify_webpage(
        'https://docs.python.org/3/',
        '<h1>Python Documentation</h1><p>Welcome to Python.org</p>',
        mock_llm_complete as <T>(prompt: string, system_prompt: string, model?: string) => Promise<T>
      );

      expect(result.page_type).toBe('knowledge');
      expect(result.confidence).toBe(0.9);
      expect(result.should_process).toBe(true);
      expect(mock_llm_complete).toHaveBeenCalledWith(
        expect.stringContaining('https://docs.python.org/3/'),
        expect.any(String),
        'gpt-4o-mini'
      );
    });

    it('should truncate long content to 2000 characters', async () => {
      const mock_llm_complete = jest.fn<
        (prompt: string, system_prompt: string, model?: string) => Promise<PageClassification>
      >().mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.8,
        reasoning: 'Long article',
        should_process: true
      });

      const long_content = 'x'.repeat(3000);
      await classify_webpage(
        'https://example.com',
        long_content,
        mock_llm_complete as <T>(prompt: string, system_prompt: string, model?: string) => Promise<T>
      );

      const call_args = mock_llm_complete.mock.calls[0][0];
      expect(call_args).toContain('x'.repeat(2000));
      expect(call_args).not.toContain('x'.repeat(2001));
    });
  });

  describe('should_process_page', () => {
    const knowledge_page: PageClassification = {
      page_type: 'knowledge',
      confidence: 0.9,
      reasoning: 'Educational content',
      should_process: true
    };

    const app_page: PageClassification = {
      page_type: 'interactive_app',
      confidence: 0.95,
      reasoning: 'Web application',
      should_process: false
    };

    it('should process knowledge pages by default', () => {
      expect(should_process_page(knowledge_page, DEFAULT_FILTER_CONFIG)).toBe(true);
    });

    it('should not process interactive apps by default', () => {
      expect(should_process_page(app_page, DEFAULT_FILTER_CONFIG)).toBe(false);
    });

    it('should respect disabled filter', () => {
      const config: FilterConfig = {
        ...DEFAULT_FILTER_CONFIG,
        enabled: false
      };
      expect(should_process_page(app_page, config)).toBe(true);
    });

    it('should respect confidence threshold', () => {
      const low_confidence_page: PageClassification = {
        ...knowledge_page,
        confidence: 0.5
      };
      expect(should_process_page(low_confidence_page, DEFAULT_FILTER_CONFIG)).toBe(false);
    });

    it('should allow multiple page types', () => {
      const config: FilterConfig = {
        ...DEFAULT_FILTER_CONFIG,
        allowed_types: ['knowledge', 'interactive_app']
      };
      expect(should_process_page(app_page, config)).toBe(false); // still false due to should_process
    });

    it('should respect model recommendation', () => {
      const page_with_override: PageClassification = {
        page_type: 'knowledge',
        confidence: 0.9,
        reasoning: 'Looks like knowledge but actually not useful',
        should_process: false
      };
      expect(should_process_page(page_with_override, DEFAULT_FILTER_CONFIG)).toBe(false);
    });
  });

  describe('log_filter_decision', () => {
    let console_spy: jest.SpiedFunction<typeof console.log>;

    beforeEach(() => {
      console_spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      console_spy.mockRestore();
    });

    it('should log accepted pages', () => {
      const classification: PageClassification = {
        page_type: 'knowledge',
        confidence: 0.9,
        reasoning: 'Technical documentation',
        should_process: true
      };

      log_filter_decision('https://example.com', classification, true, DEFAULT_FILTER_CONFIG);

      expect(console_spy).toHaveBeenCalledWith(expect.stringContaining('✅ ACCEPTED'));
      expect(console_spy).toHaveBeenCalledWith(expect.stringContaining('https://example.com'));
      expect(console_spy).toHaveBeenCalledWith(expect.stringContaining('knowledge'));
    });

    it('should log filtered pages', () => {
      const classification: PageClassification = {
        page_type: 'interactive_app',
        confidence: 0.95,
        reasoning: 'Dashboard application',
        should_process: false
      };

      log_filter_decision('https://app.example.com', classification, false, DEFAULT_FILTER_CONFIG);

      expect(console_spy).toHaveBeenCalledWith(expect.stringContaining('❌ FILTERED'));
      expect(console_spy).toHaveBeenCalledWith(expect.stringContaining('interactive_app'));
    });

    it('should not log when logging is disabled', () => {
      const config: FilterConfig = {
        ...DEFAULT_FILTER_CONFIG,
        log_decisions: false
      };

      const classification: PageClassification = {
        page_type: 'knowledge',
        confidence: 0.9,
        reasoning: 'Test',
        should_process: true
      };

      log_filter_decision('https://example.com', classification, true, config);

      expect(console_spy).not.toHaveBeenCalled();
    });
  });
});