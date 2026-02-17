export const obscureEmail = (email: string) => {
    const arr = email.split("@");
    const name = arr[0];
    const domain = arr[1];

    const censoredName = name[0] + "*".repeat(name.length - 2) + name.slice(-1);
    const censoredDomain = domain[0] + "*".repeat(domain.length - 2) + domain.slice(-1);

    return censoredName + "@" + censoredDomain;
};