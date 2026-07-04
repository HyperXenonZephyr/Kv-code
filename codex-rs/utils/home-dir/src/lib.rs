use codex_utils_absolute_path::AbsolutePathBuf;
use dirs::home_dir;
use std::path::PathBuf;

/// Returns the path to the KV Code configuration directory.
///
/// - If `KV_CODE_HOME` is set, the value must exist and be a directory. The
///   value will be canonicalized and this function will Err otherwise.
/// - If `KV_CODE_HOME` is not set, `CODEX_HOME` is honored for migration.
/// - If neither variable is set, this function defaults to `~/.kv-code` and
///   does not verify that the directory exists.
pub fn find_codex_home() -> std::io::Result<AbsolutePathBuf> {
    let kv_code_home_env = std::env::var("KV_CODE_HOME")
        .ok()
        .filter(|val| !val.is_empty());
    let codex_home_env = std::env::var("CODEX_HOME")
        .ok()
        .filter(|val| !val.is_empty());
    find_codex_home_from_env(kv_code_home_env.as_deref(), codex_home_env.as_deref())
}

fn find_codex_home_from_env(
    kv_code_home_env: Option<&str>,
    codex_home_env: Option<&str>,
) -> std::io::Result<AbsolutePathBuf> {
    let configured_home = kv_code_home_env
        .map(|value| ("KV_CODE_HOME", value))
        .or_else(|| codex_home_env.map(|value| ("CODEX_HOME", value)));

    match configured_home {
        Some((env_name, val)) => {
            let path = PathBuf::from(val);
            let metadata = std::fs::metadata(&path).map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("{env_name} points to {val:?}, but that path does not exist"),
                ),
                _ => std::io::Error::new(
                    err.kind(),
                    format!("failed to read {env_name} {val:?}: {err}"),
                ),
            })?;

            if !metadata.is_dir() {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("{env_name} points to {val:?}, but that path is not a directory"),
                ))
            } else {
                let canonical = path.canonicalize().map_err(|err| {
                    std::io::Error::new(
                        err.kind(),
                        format!("failed to canonicalize {env_name} {val:?}: {err}"),
                    )
                })?;
                AbsolutePathBuf::from_absolute_path(canonical)
            }
        }
        None => {
            let mut p = home_dir().ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not find home directory",
                )
            })?;
            p.push(".kv-code");
            AbsolutePathBuf::from_absolute_path(p)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::find_codex_home_from_env;
    use codex_utils_absolute_path::AbsolutePathBuf;
    use dirs::home_dir;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn kv_code_home_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-kv-code-home");
        let missing_str = missing
            .to_str()
            .expect("missing KV Code home path should be valid utf-8");

        let err =
            find_codex_home_from_env(Some(missing_str), None).expect_err("missing KV_CODE_HOME");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("KV_CODE_HOME"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn kv_code_home_env_file_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let file_path = temp_home.path().join("kv-code-home.txt");
        fs::write(&file_path, "not a directory").expect("write temp file");
        let file_str = file_path
            .to_str()
            .expect("file KV Code home path should be valid utf-8");

        let err = find_codex_home_from_env(Some(file_str), None).expect_err("file KV_CODE_HOME");
        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(
            err.to_string().contains("not a directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn kv_code_home_env_valid_directory_canonicalizes() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp KV Code home path should be valid utf-8");

        let resolved = find_codex_home_from_env(Some(temp_str), None).expect("valid KV_CODE_HOME");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn codex_home_env_valid_directory_remains_supported() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp legacy home path should be valid utf-8");

        let resolved = find_codex_home_from_env(None, Some(temp_str)).expect("valid CODEX_HOME");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn kv_code_home_takes_precedence_over_codex_home() {
        let kv_home = TempDir::new().expect("temp KV Code home");
        let codex_home = TempDir::new().expect("temp legacy home");
        let kv_home_str = kv_home
            .path()
            .to_str()
            .expect("KV Code home path should be valid utf-8");
        let codex_home_str = codex_home
            .path()
            .to_str()
            .expect("legacy home path should be valid utf-8");

        let resolved =
            find_codex_home_from_env(Some(kv_home_str), Some(codex_home_str)).expect("valid homes");
        let expected = kv_home
            .path()
            .canonicalize()
            .expect("canonicalize KV Code home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_codex_home_without_env_uses_default_home_dir() {
        let resolved = find_codex_home_from_env(None, None).expect("default KV Code home");
        let mut expected = home_dir().expect("home dir");
        expected.push(".kv-code");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }
}
