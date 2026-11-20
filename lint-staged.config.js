import path from "node:path";

const isImportedSkill = (file) =>
  /(?:^|[/\\])\.(?:agents|claude|github)[/\\]skills[/\\]sf-[^/\\]+[/\\]/.test(
    file,
  );

const filterAndQuote = (files) =>
  files
    .filter((file) => !isImportedSkill(file))
    .map((file) =>
      JSON.stringify(path.relative(process.cwd(), file).replaceAll("\\", "/")),
    );

export default {
  "**/*.{cls,cmp,component,css,html,js,json,md,page,trigger,xml,yaml,yml}": (
    files,
  ) => {
    const filtered = filterAndQuote(files);
    return filtered.length ? `prettier --write ${filtered.join(" ")}` : [];
  },
  "**/{aura,lwc}/**/*.js": (files) => {
    const filtered = filterAndQuote(files);
    return filtered.length ? `eslint ${filtered.join(" ")}` : [];
  },
  "**/lwc/**": (files) => {
    const filtered = filterAndQuote(files);
    return filtered.length
      ? `sfdx-lwc-jest -- --bail --findRelatedTests --passWithNoTests ${filtered.join(" ")}`
      : [];
  },
};
