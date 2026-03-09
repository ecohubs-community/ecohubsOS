export const obscureEmail = (email: string) => {
    const arr = email.split("@");
    const name = arr[0];
    const domain = arr[1];

    const censoredName = name[0] + "*".repeat(name.length - 2) + name.slice(-1);

    return censoredName + "@" + domain;
};

/**
 * Returns only the first name from a full name string.
 * e.g. "John Smith" → "John", "Jane Mary Doe" → "Jane"
 */
export const getFirstName = (fullName: string): string => {
    return fullName.trim().split(/\s+/)[0];
};

/**
 * Obscures the last name(s) in a full name string.
 * e.g. "John Smith" → "John S.", "Jane Mary Doe" → "Jane M. D."
 */
export const obscureLastName = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return parts[0] ?? fullName;
    const firstName = parts[0];
    const obscuredRest = parts.slice(1).map((p) => p[0] + '.').join(' ');
    return `${firstName} ${obscuredRest}`;
};