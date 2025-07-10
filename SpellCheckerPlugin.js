// SpellCheckPlugin.js
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';

// Custom node for spelling errors
export class SpellCheckNode extends TextNode {
  static getType() {
    return 'spell-check';
  }

  static clone(node) {
    return new SpellCheckNode(node.__text, node.__suggestions, node.__key);
  }

  constructor(text, suggestions = [], key) {
    super(text, key);
    this.__suggestions = suggestions;
  }

  getSuggestions() {
    return this.__suggestions;
  }

  setSuggestions(suggestions) {
    const writable = this.getWritable();
    writable.__suggestions = suggestions;
  }

  createDOM(config) {
    const element = super.createDOM(config);
    element.className = 'spell-check-error';
    element.style.textDecoration = 'underline';
    element.style.textDecorationColor = 'red';
    element.style.textDecorationStyle = 'wavy';
    element.title = `Spelling error. Suggestions: ${this.__suggestions.join(', ')}`;
    return element;
  }

  updateDOM(prevNode, dom) {
    const updated = super.updateDOM(prevNode, dom);
    if (this.__suggestions !== prevNode.__suggestions) {
      dom.title = `Spelling error. Suggestions: ${this.__suggestions.join(', ')}`;
    }
    return updated;
  }

  static importJSON(serializedNode) {
    const { text, suggestions } = serializedNode;
    return $createSpellCheckNode(text, suggestions);
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      suggestions: this.__suggestions,
      type: 'spell-check',
      version: 1,
    };
  }

  setTextContent(text) {
    const writable = this.getWritable();
    writable.__text = text;
  }
}

export function $createSpellCheckNode(text, suggestions = []) {
  return new SpellCheckNode(text, suggestions);
}

export function $isSpellCheckNode(node) {
  return node instanceof SpellCheckNode;
}

// LanguageTool API service
class LanguageToolService {
  constructor(apiUrl = 'http://localhost:8010/v2/check') {
    this.apiUrl = apiUrl;
    this.cache = new Map();
  }

  async checkText(text) {
    // Simple caching to avoid redundant API calls
    const cacheKey = text.trim().toLowerCase();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          text: text,
          language: 'en-US',
          enabledOnly: 'false',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const result = this.processLanguageToolResponse(data);
      
      // Cache the result
      this.cache.set(cacheKey, result);
      
      return result;
    } catch (error) {
      console.error('LanguageTool API error:', error);
      return [];
    }
  }

  processLanguageToolResponse(data) {
    return data.matches
      .filter(match => match.rule.category.id === 'TYPOS')
      .map(match => ({
        offset: match.offset,
        length: match.length,
        word: match.context.text.substring(match.offset, match.offset + match.length),
        suggestions: match.replacements.map(r => r.value).slice(0, 5), // Limit to 5 suggestions
        message: match.message,
      }));
  }

  clearCache() {
    this.cache.clear();
  }
}

// Spell check plugin hook
export function useSpellCheckPlugin() {
  const [editor] = useLexicalComposerContext();
  const languageToolService = new LanguageToolService();

  useEffect(() => {
    if (!editor) return;

    let timeoutId = null;

    const performSpellCheck = async () => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const root = editor.getEditorState()._nodeMap.get('root');
        if (!root) return;

        const textContent = root.getTextContent();
        if (!textContent.trim()) return;

        // Debounce spell checking
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(async () => {
          try {
            const errors = await languageToolService.checkText(textContent);
            
            editor.update(() => {
              // First, convert all SpellCheckNodes back to TextNodes
              const nodesToReplace = [];
              
              root.getChildren().forEach(paragraph => {
                paragraph.getChildren().forEach(node => {
                  if ($isSpellCheckNode(node)) {
                    nodesToReplace.push({
                      node,
                      replacement: $createTextNode(node.getTextContent()),
                    });
                  }
                });
              });

              // Replace spell check nodes with regular text nodes
              nodesToReplace.forEach(({ node, replacement }) => {
                node.replace(replacement);
              });

              // Now apply new spell check highlights
              if (errors.length > 0) {
                applySpellCheckHighlights(root, errors);
              }
            });
          } catch (error) {
            console.error('Spell check error:', error);
          }
        }, 500); // 500ms debounce
      });
    };

    const applySpellCheckHighlights = (root, errors) => {
      const allTextNodes = [];
      
      // Collect all text nodes with their positions
      let currentOffset = 0;
      root.getChildren().forEach(paragraph => {
        paragraph.getChildren().forEach(node => {
          if ($isTextNode(node)) {
            const text = node.getTextContent();
            allTextNodes.push({
              node,
              text,
              startOffset: currentOffset,
              endOffset: currentOffset + text.length,
            });
            currentOffset += text.length;
          }
        });
      });

      // Apply highlights for each error
      errors.forEach(error => {
        const errorStart = error.offset;
        const errorEnd = error.offset + error.length;

        // Find the text node that contains this error
        for (const textNodeInfo of allTextNodes) {
          if (errorStart >= textNodeInfo.startOffset && errorEnd <= textNodeInfo.endOffset) {
            const relativeStart = errorStart - textNodeInfo.startOffset;
            const relativeEnd = errorEnd - textNodeInfo.startOffset;
            
            highlightErrorInNode(textNodeInfo.node, relativeStart, relativeEnd, error.suggestions);
            break;
          }
        }
      });
    };

    const highlightErrorInNode = (node, start, end, suggestions) => {
      const text = node.getTextContent();
      const beforeText = text.substring(0, start);
      const errorText = text.substring(start, end);
      const afterText = text.substring(end);

      const nodes = [];
      
      if (beforeText) {
        nodes.push($createTextNode(beforeText));
      }
      
      nodes.push($createSpellCheckNode(errorText, suggestions));
      
      if (afterText) {
        nodes.push($createTextNode(afterText));
      }

      // Replace the original node with the new nodes
      if (nodes.length > 0) {
        node.replace(nodes[0]);
        for (let i = 1; i < nodes.length; i++) {
          nodes[i - 1].insertAfter(nodes[i]);
        }
      }
    };

    // Register listeners
    const removeListeners = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          performSpellCheck();
        });
      }),
      
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          performSpellCheck();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      removeListeners();
    };
  }, [editor]);

  return null;
}

// Context menu component for spell check suggestions
export function SpellCheckContextMenu({ editor, spellCheckNode, onClose }) {
  const suggestions = spellCheckNode.getSuggestions();

  const handleSuggestionClick = (suggestion) => {
    editor.update(() => {
      spellCheckNode.replace($createTextNode(suggestion));
    });
    onClose();
  };

  const handleIgnore = () => {
    editor.update(() => {
      spellCheckNode.replace($createTextNode(spellCheckNode.getTextContent()));
    });
    onClose();
  };

  return (
    <div className="spell-check-context-menu">
      <div className="spell-check-suggestions">
        {suggestions.length > 0 ? (
          suggestions.map((suggestion, index) => (
            <button
              key={index}
              className="spell-check-suggestion"
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {suggestion}
            </button>
          ))
        ) : (
          <div className="no-suggestions">No suggestions available</div>
        )}
      </div>
      <div className="spell-check-actions">
        <button onClick={handleIgnore}>Ignore</button>
      </div>
    </div>
  );
}

// CSS styles (add to your stylesheet)
const styles = `
.spell-check-error {
  text-decoration: underline;
  text-decoration-color: red;
  text-decoration-style: wavy;
  cursor: pointer;
}

.spell-check-context-menu {
  position: absolute;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 150px;
}

.spell-check-suggestions {
  padding: 8px 0;
  border-bottom: 1px solid #eee;
}

.spell-check-suggestion {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
}

.spell-check-suggestion:hover {
  background-color: #f5f5f5;
}

.spell-check-actions {
  padding: 8px 0;
}

.spell-check-actions button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
}

.spell-check-actions button:hover {
  background-color: #f5f5f5;
}

.no-suggestions {
  padding: 8px 12px;
  color: #666;
  font-size: 14px;
}
`;

export { styles as spellCheckStyles };
