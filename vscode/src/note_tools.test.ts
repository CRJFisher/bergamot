import { NoteTools } from './note_tools';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Note } from './model_schema';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn()
  }
}));

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  basename: jest.fn((path, ext) => {
    const filename = path.split('/').pop();
    if (ext && filename.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
    return filename;
  })
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockJoin = join as jest.MockedFunction<typeof join>;

// Mock file system responses
const mockDirents = {
  createMockFile: (name: string) => ({ 
    name, 
    isDirectory: () => false, 
    isFile: () => true 
  }),
  createMockDir: (name: string) => ({ 
    name, 
    isDirectory: () => true, 
    isFile: () => false 
  })
};

const mockStats = (mtime: Date, birthtime: Date) => ({
  mtime,
  birthtime,
  isDirectory: () => false,
  isFile: () => true
});

describe('NoteTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetch_existing_notes', () => {
    it('should fetch notes successfully', async () => {
      const mockDate1 = new Date('2024-01-01');
      const mockDate2 = new Date('2024-01-02');
      
      // Mock fs.access to succeed
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock directory structure
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('note1.md'),
        mockDirents.createMockFile('note2.md'),
        mockDirents.createMockDir('subdir')
      ] as any);
      
      // Mock subdirectory (empty)
      mockFs.readdir.mockResolvedValueOnce([]);
      
      // Mock file stats
      mockFs.stat
        .mockResolvedValueOnce(mockStats(mockDate2, mockDate1) as any) // note1.md
        .mockResolvedValueOnce(mockStats(mockDate1, mockDate1) as any); // note2.md
      
      // Mock file contents
      const note1Content = `# Note 1 Title

This is the description of note 1.

## Section 1

Content for section 1.

## Section 2

Content for section 2.`;

      const note2Content = `# Note 2 Title

This is the description of note 2.

General content without sections.`;

      mockFs.readFile
        .mockResolvedValueOnce(note1Content)
        .mockResolvedValueOnce(note2Content);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(2);
      
      // First note should be note1 (more recent)
      expect(result[0].name).toBe('note1');
      expect(result[0].sections).toEqual(['Section 1', 'Section 2']);
      expect(result[0].description).toBe('This is the description of note 1.');
      expect(result[0].body).toBe(note1Content);
      expect(result[0].created_at).toEqual(mockDate1);
      expect(result[0].updated_at).toEqual(mockDate2);
      
      // Second note should be note2 (older)
      expect(result[1].name).toBe('note2');
      expect(result[1].sections).toEqual(['General']);
      expect(result[1].description).toBe('This is the description of note 2.\n\nGeneral content without sections.');
      expect(result[1].body).toBe(note2Content);
    });

    it('should respect the limit parameter', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('note1.md'),
        mockDirents.createMockFile('note2.md'),
        mockDirents.createMockFile('note3.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat
        .mockResolvedValue(mockStats(mockDate, mockDate) as any);

      const noteContent = `# Test Note\n\nTest content.`;
      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes(2);

      expect(result).toHaveLength(2);
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });

    it('should handle notes without sections', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('simple-note.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);

      const noteContent = `# Simple Note

This is a simple note without any sections.
Just some content here.`;

      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(1);
      expect(result[0].sections).toEqual(['General']);
      expect(result[0].description).toBe('This is a simple note without any sections.\nJust some content here.');
    });

    it('should handle notes without description (no first heading)', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('no-heading.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);

      const noteContent = `Just some content without any heading.

## Section 1

Some section content.`;

      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(1);
      expect(result[0].sections).toEqual(['Section 1']);
      expect(result[0].description).toBe('');
    });

    it('should skip ignored folders', async () => {
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock main directory with ignored folders
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockDir('node_modules'), // Should be ignored
        mockDirents.createMockDir('.obsidian'), // Should be ignored  
        mockDirents.createMockDir('Front Page'), // Should be ignored
        mockDirents.createMockFile('note.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);
      mockFs.readFile.mockResolvedValue('# Test Note\n\nContent');

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('note');
    });

    it('should handle directory access errors', async () => {
      mockFs.access.mockRejectedValue(new Error('Directory not found'));

      await expect(NoteTools.fetch_existing_notes())
        .rejects.toThrow('Directory /Users/chuck/workspace/pkm does not exist');
    });

    it('should handle directory read errors gracefully', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      // Should log error and then throw "No notes found" because no notes were processed
      await expect(NoteTools.fetch_existing_notes())
        .rejects.toThrow('No notes found');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error searching directory'),
        expect.any(Error)
      );
    });

    it('should handle file read errors', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('problematic.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);
      mockFs.readFile.mockRejectedValue(new Error('File read error'));

      await expect(NoteTools.fetch_existing_notes())
        .rejects.toThrow('File read error');
    });

    it('should handle empty notes directory', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await expect(NoteTools.fetch_existing_notes())
        .rejects.toThrow('No notes found');
    });

    it('should handle complex nested directory structure', async () => {
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock nested directory structure
      mockFs.readdir
        .mockResolvedValueOnce([
          mockDirents.createMockDir('level1'),
          mockDirents.createMockFile('root-note.md')
        ] as any)
        .mockResolvedValueOnce([
          mockDirents.createMockDir('level2'),
          mockDirents.createMockFile('level1-note.md')
        ] as any)
        .mockResolvedValueOnce([
          mockDirents.createMockFile('level2-note.md')
        ] as any);

      const mockDate1 = new Date('2024-01-01');
      const mockDate2 = new Date('2024-01-02');
      const mockDate3 = new Date('2024-01-03');
      
      mockFs.stat
        .mockResolvedValueOnce(mockStats(mockDate1, mockDate1) as any) // root-note.md
        .mockResolvedValueOnce(mockStats(mockDate2, mockDate2) as any) // level1-note.md
        .mockResolvedValueOnce(mockStats(mockDate3, mockDate3) as any); // level2-note.md

      const noteContent = '# Test Note\n\nContent';
      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(3);
      // Should be sorted by modified time (most recent first)
      // Note: The order depends on when the files are discovered, not when mocked
      // Since all files are processed by find_markdown_files first, then sorted
      expect(result[0].updated_at).toEqual(mockDate3); // Most recent
      expect(result[2].updated_at).toEqual(mockDate1); // Oldest
    });

    it('should handle notes with only heading and no content', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('empty-note.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);

      const noteContent = `# Empty Note Title`;
      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('empty-note');
      expect(result[0].sections).toEqual(['General']);
      expect(result[0].description).toBe('');
    });

    it('should handle notes with sections but no main description', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('sections-only.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat.mockResolvedValue(mockStats(mockDate, mockDate) as any);

      const noteContent = `# Sections Only
## Section 1

Content 1

## Section 2

Content 2`;

      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(1);
      expect(result[0].sections).toEqual(['Section 1', 'Section 2']);
      expect(result[0].description).toBe('');
    });

    it('should sort files by last modified time descending', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('old-note.md'),
        mockDirents.createMockFile('new-note.md'),
        mockDirents.createMockFile('middle-note.md')
      ] as any);

      const oldDate = new Date('2024-01-01');
      const middleDate = new Date('2024-01-15');
      const newDate = new Date('2024-01-30');
      
      mockFs.stat
        .mockResolvedValueOnce(mockStats(oldDate, oldDate) as any) // old-note.md
        .mockResolvedValueOnce(mockStats(newDate, newDate) as any) // new-note.md
        .mockResolvedValueOnce(mockStats(middleDate, middleDate) as any); // middle-note.md

      const noteContent = '# Test\n\nContent';
      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('new-note');
      expect(result[1].name).toBe('middle-note');
      expect(result[2].name).toBe('old-note');
    });

    it('should handle schema validation errors', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockFile('invalid-note.md')
      ] as any);

      // Mock invalid date to trigger schema validation error
      const invalidStats = {
        mtime: 'invalid-date',
        birthtime: 'invalid-date',
        isDirectory: () => false,
        isFile: () => true
      };
      
      mockFs.stat.mockResolvedValue(invalidStats as any);
      mockFs.readFile.mockResolvedValue('# Test\n\nContent');

      await expect(NoteTools.fetch_existing_notes())
        .rejects.toThrow();
    });
  });

  describe('create_note', () => {
    it('should create a note and return success message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = NoteTools.create_note('My New Note');
      
      expect(result).toBe('Successfully created note My New Note');
      expect(consoleSpy).toHaveBeenCalledWith('Creating note: My New Note');
      
      consoleSpy.mockRestore();
    });

    it('should handle empty note name', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = NoteTools.create_note('');
      
      expect(result).toBe('Successfully created note ');
      expect(consoleSpy).toHaveBeenCalledWith('Creating note: ');
      
      consoleSpy.mockRestore();
    });

    it('should handle note names with special characters', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const specialName = 'Note with spaces & symbols!';
      const result = NoteTools.create_note(specialName);
      
      expect(result).toBe(`Successfully created note ${specialName}`);
      expect(consoleSpy).toHaveBeenCalledWith(`Creating note: ${specialName}`);
      
      consoleSpy.mockRestore();
    });
  });

  describe('create_section', () => {
    it('should create a section and return success message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = NoteTools.create_section('My Note', 'New Section');
      
      expect(result).toBe('Successfully created section New Section in My Note');
      expect(consoleSpy).toHaveBeenCalledWith('Creating section: New Section in My Note');
      
      consoleSpy.mockRestore();
    });

    it('should handle empty section name', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = NoteTools.create_section('My Note', '');
      
      expect(result).toBe('Successfully created section  in My Note');
      expect(consoleSpy).toHaveBeenCalledWith('Creating section:  in My Note');
      
      consoleSpy.mockRestore();
    });

    it('should handle empty note name', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = NoteTools.create_section('', 'New Section');
      
      expect(result).toBe('Successfully created section New Section in ');
      expect(consoleSpy).toHaveBeenCalledWith('Creating section: New Section in ');
      
      consoleSpy.mockRestore();
    });

    it('should handle section names with special characters', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const noteName = 'Project Notes';
      const sectionName = 'Section with spaces & symbols!';
      const result = NoteTools.create_section(noteName, sectionName);
      
      expect(result).toBe(`Successfully created section ${sectionName} in ${noteName}`);
      expect(consoleSpy).toHaveBeenCalledWith(`Creating section: ${sectionName} in ${noteName}`);
      
      consoleSpy.mockRestore();
    });
  });

  describe('find_markdown_files integration', () => {
    it('should handle Weekly folder exclusion correctly', async () => {
      mockFs.access.mockResolvedValue(undefined);
      
      // Mock the exact path that should be ignored
      mockJoin.mockImplementation((...args) => {
        const result = args.join('/');
        return result;
      });
      
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockDir('Tasks'),
        mockDirents.createMockFile('regular-note.md')
      ] as any);
      
      // Mock Tasks directory
      mockFs.readdir.mockResolvedValueOnce([
        mockDirents.createMockDir('Weekly'), // This should be ignored
        mockDirents.createMockFile('task-note.md')
      ] as any);

      const mockDate = new Date('2024-01-01');
      mockFs.stat
        .mockResolvedValueOnce(mockStats(mockDate, mockDate) as any) // regular-note.md
        .mockResolvedValueOnce(mockStats(mockDate, mockDate) as any); // task-note.md

      const noteContent = '# Test Note\n\nContent';
      mockFs.readFile.mockResolvedValue(noteContent);

      const result = await NoteTools.fetch_existing_notes();

      // Should have both regular-note and task-note, but nothing from Weekly
      expect(result).toHaveLength(2);
      // Order may vary based on discovery order, just check both are present
      const noteNames = result.map(n => n.name).sort();
      expect(noteNames).toEqual(['regular-note', 'task-note']);
    });
  });
});