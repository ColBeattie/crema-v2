# Common Build Errors and Fixes for React/Next.js Applications

Here are the most common build issues you should watch out for in any React/Next.js project:

## ESLint/React Issues

- **Unescaped quotes and apostrophes in JSX**: Always escape quotes (") and apostrophes (') in JSX strings
  - Use `&quot;` for double quotes: `"Create users with &quot;model&quot; role"`
  - Use `&apos;` for apostrophes: `"They won&apos;t be able to login"`
  - Alternative: Use template literals or different quote types to avoid conflicts

## Next.js API Route Issues

- **Next.js 15 async params**: API route parameters must be awaited in Next.js 15+
  - Wrong: `{ params }: { params: { id: string } }`
  - Correct: `{ params }: { params: Promise<{ id: string }> }`
  - Always add: `const { id } = await params` before using the parameter

## TypeScript Type Issues

- **Null vs undefined consistency**: Be consistent with nullable types in interfaces
  - Use `string | null` or `string | undefined` consistently throughout your app
  - Don't mix null and undefined for the same property across different interfaces
- **Missing type annotations in catch blocks**: Always type error parameters
  - Wrong: `catch (error) {}`
  - Correct: `catch (error: any) {}` or `catch (error: unknown) {}`
- **Third-party library types**: Some properties might not exist in type definitions
  - Use type assertions `(obj as any).property` when necessary
  - Cast data to `any` for problematic chart/library components: `data={chartData as any}`

## Form and Input Issues

- **Select input values**: Handle null values in form inputs properly
  - Wrong: `value={filterType}` (when filterType can be null)
  - Correct: `value={filterType || ''}` or provide a default value
- **Component prop validation**: Remove props that don't exist in component interfaces
  - Check component prop types before passing unknown properties
  - Remove unused props like `name`, `required`, etc. if not supported

## Server Component Issues

- **Incorrect function calls in server components**: Match the expected function signature
  - Wrong: `createClient(await cookies())` (when function expects no arguments)
  - Correct: `createClient()` (check the actual function signature)

## Promise and Async Issues

- **Optional function calls returning promises**: Handle undefined function calls properly
  - Wrong: `onSave={(code) => onPhoneCountryCodeChange?.(code)}` (returns Promise<void> | undefined)
  - Correct:
    ```javascript
    onSave={async (code) => {
      if (onPhoneCountryCodeChange) {
        await onPhoneCountryCodeChange(code);
      }
    }}
    ```

## Array and Object Property Access

- **Accessing properties on arrays**: Don't access object properties on arrays
  - Wrong: `assignment.operators.auth_id` (when operators is an array)
  - Correct: `assignment.operators?.[0]?.auth_id` or proper array handling
- **Non-existent properties**: Always verify properties exist in your type definitions
  - Comment out or replace references to properties that don't exist
  - Use placeholder values or alternative properties that do exist

## Error Handling

- Use a consistent error handling pattern: user-facing errors should be friendly messages, logged errors should include stack traces and context.
- Never swallow errors silently.

## Best Practices

1. **Use TypeScript strictly**: Enable strict mode and fix all type errors
2. **Validate component props**: Always check component prop interfaces before using
3. **Handle nullable values**: Be explicit about null/undefined handling in forms and components
4. **Escape special characters**: Always escape quotes and special characters in JSX strings
5. **Keep types consistent**: Use the same nullable patterns across your entire application
6. **Type error handlers**: Always provide type annotations in catch blocks
7. **Verify third-party types**: Don't assume all properties exist in library type definitions

## Common Error Patterns to Avoid

- Unescaped quotes in JSX strings
- Missing await on Next.js 15 route params
- Inconsistent null/undefined types
- Untyped error parameters in catch blocks
- Accessing object properties on arrays
- Passing invalid props to components
- Missing alt attributes on images
- Using deprecated or non-existent API patterns

## Quick Fix Checklist

- [ ] All quotes and apostrophes escaped in JSX
- [ ] Route params properly awaited in Next.js 15+
- [ ] Consistent null/undefined handling in types
- [ ] All error parameters typed in catch blocks
- [ ] Form inputs handle null values properly
- [ ] Component props match their interfaces
- [ ] No references to non-existent object properties
- [ ] All async functions properly handled
