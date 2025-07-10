import org.languagetool.JLanguageTool;
import org.languagetool.Languages;
import org.languagetool.rules.RuleMatch;
import org.languagetool.rules.spelling.SpellingCheckRule;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * A spell checker service using LanguageTool for government applications.
 * Provides spell checking functionality with suggestions for corrections.
 */
public class LanguageToolSpellChecker {
    
    private final JLanguageTool languageTool;
    
    /**
     * Initialize the spell checker with English language support.
     * For government applications, you may want to add custom dictionaries.
     */
    public LanguageToolSpellChecker() {
        this.languageTool = new JLanguageTool(Languages.getLanguageForShortCode("en-US"));
        
        // Enable only spelling rules for better performance
        languageTool.disableRules(languageTool.getAllRules().stream()
            .filter(rule -> !(rule instanceof SpellingCheckRule))
            .map(rule -> rule.getId())
            .toArray(String[]::new));
    }
    
    /**
     * Check text for spelling errors and return results.
     * 
     * @param text The text to spell check
     * @return SpellCheckResult containing success status and suggestions
     */
    public SpellCheckResult checkSpelling(String text) {
        if (text == null || text.trim().isEmpty()) {
            return new SpellCheckResult(true, new ArrayList<>());
        }
        
        try {
            List<RuleMatch> matches = languageTool.check(text);
            
            if (matches.isEmpty()) {
                return new SpellCheckResult(true, new ArrayList<>());
            }
            
            List<SpellingSuggestion> suggestions = new ArrayList<>();
            
            for (RuleMatch match : matches) {
                SpellingSuggestion suggestion = new SpellingSuggestion(
                    match.getFromPos(),
                    match.getToPos(),
                    text.substring(match.getFromPos(), match.getToPos()),
                    match.getSuggestedReplacements(),
                    match.getMessage()
                );
                suggestions.add(suggestion);
            }
            
            return new SpellCheckResult(false, suggestions);
            
        } catch (IOException e) {
            throw new RuntimeException("Error during spell checking", e);
        }
    }
    
    /**
     * Add custom words to the spell checker dictionary.
     * Useful for government-specific terminology, acronyms, etc.
     * 
     * @param words List of words to add to the dictionary
     */
    public void addCustomWords(List<String> words) {
        // Note: This is a simplified approach. For production use,
        // you may want to implement a more sophisticated custom dictionary
        for (String word : words) {
            languageTool.addIgnoreTokens(List.of(word));
        }
    }
    
    /**
     * Clean up resources when done.
     */
    public void close() {
        // LanguageTool doesn't require explicit cleanup, but good practice
        // to have this method for future enhancements
    }
    
    /**
     * Result class containing spell check results.
     */
    public static class SpellCheckResult {
        private final boolean isValid;
        private final List<SpellingSuggestion> suggestions;
        
        public SpellCheckResult(boolean isValid, List<SpellingSuggestion> suggestions) {
            this.isValid = isValid;
            this.suggestions = suggestions;
        }
        
        public boolean isValid() {
            return isValid;
        }
        
        public List<SpellingSuggestion> getSuggestions() {
            return suggestions;
        }
        
        public boolean hasErrors() {
            return !isValid;
        }
        
        public int getErrorCount() {
            return suggestions.size();
        }
    }
    
    /**
     * Class representing a single spelling suggestion.
     */
    public static class SpellingSuggestion {
        private final int startPos;
        private final int endPos;
        private final String originalText;
        private final List<String> replacements;
        private final String message;
        
        public SpellingSuggestion(int startPos, int endPos, String originalText, 
                                List<String> replacements, String message) {
            this.startPos = startPos;
            this.endPos = endPos;
            this.originalText = originalText;
            this.replacements = replacements;
            this.message = message;
        }
        
        public int getStartPos() {
            return startPos;
        }
        
        public int getEndPos() {
            return endPos;
        }
        
        public String getOriginalText() {
            return originalText;
        }
        
        public List<String> getReplacements() {
            return replacements;
        }
        
        public String getMessage() {
            return message;
        }
        
        public String getBestSuggestion() {
            return replacements.isEmpty() ? originalText : replacements.get(0);
        }
    }
}

// Example usage class
class SpellCheckerExample {
    public static void main(String[] args) {
        LanguageToolSpellChecker spellChecker = new LanguageToolSpellChecker();
        
        // Add government-specific terms
        List<String> customWords = List.of("API", "JSON", "OAuth", "IPv4", "HTTPS");
        spellChecker.addCustomWords(customWords);
        
        // Test with text containing spelling errors
        String testText = "This docuument contains some mispelled words and incorect grammar.";
        
        LanguageToolSpellChecker.SpellCheckResult result = spellChecker.checkSpelling(testText);
        
        if (result.isValid()) {
            System.out.println("✓ Text is spelled correctly!");
        } else {
            System.out.println("✗ Found " + result.getErrorCount() + " spelling errors:");
            
            for (LanguageToolSpellChecker.SpellingSuggestion suggestion : result.getSuggestions()) {
                System.out.println("Error: '" + suggestion.getOriginalText() + "' at position " 
                    + suggestion.getStartPos() + "-" + suggestion.getEndPos());
                System.out.println("Message: " + suggestion.getMessage());
                System.out.println("Suggestions: " + suggestion.getReplacements());
                System.out.println("Best suggestion: " + suggestion.getBestSuggestion());
                System.out.println("---");
            }
        }
        
        spellChecker.close();
    }
}